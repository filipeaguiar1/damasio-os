-- Damasio OS / 4 Ever Seasons — company receivables ledger and safe on-demand withdrawals.
-- Weekly/biweekly services are billed per completed Visit. Monthly service remains one monthly period charge.
-- Customer charges stay on the platform; released company earnings are transferred to the connected account,
-- then withdrawn from that connected Stripe balance through manual payouts.
begin;

alter table public.organizations
  add column if not exists stripe_payout_schedule text,
  add column if not exists stripe_payout_schedule_updated_at timestamptz;

create table if not exists public.company_balance_entries(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  payout_item_id uuid not null references public.company_payout_items(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  amount_cents bigint not null check(amount_cents>0),
  paid_out_cents bigint not null default 0 check(paid_out_cents>=0),
  reserved_cents bigint not null default 0 check(reserved_cents>=0),
  currency text not null default 'cad',
  state text not null default 'pending' check(state in(
    'pending','hold','release_ready','transferring','available','paid_out','reversed','disputed','cancelled'
  )),
  hold_reason text,
  stripe_charge_id text,
  stripe_transfer_id text unique,
  stripe_transfer_created_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payout_item_id),
  check(paid_out_cents+reserved_cents<=amount_cents)
);

create index if not exists company_balance_entries_company_state_idx
  on public.company_balance_entries(company_id,state,created_at desc);
create index if not exists company_balance_entries_available_idx
  on public.company_balance_entries(company_id,released_at)
  where state='available';

create table if not exists public.company_withdrawals(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete restrict,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'cad',
  status text not null default 'reserved' check(status in('reserved','processing','paid','failed','cancelled')),
  system_generated boolean not null default false,
  stripe_payout_id text unique,
  stripe_available_cents_at_request bigint,
  internal_available_cents_at_request bigint,
  estimated_arrival_at timestamptz,
  failure_code text,
  failure_message text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists company_withdrawals_company_status_idx
  on public.company_withdrawals(company_id,status,requested_at desc);

create table if not exists public.company_withdrawal_allocations(
  withdrawal_id uuid not null references public.company_withdrawals(id) on delete cascade,
  balance_entry_id uuid not null references public.company_balance_entries(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0),
  primary key(withdrawal_id,balance_entry_id)
);
create index if not exists company_withdrawal_allocations_entry_idx
  on public.company_withdrawal_allocations(balance_entry_id);

alter table public.company_balance_entries enable row level security;
alter table public.company_withdrawals enable row level security;
alter table public.company_withdrawal_allocations enable row level security;

revoke all on public.company_balance_entries from anon,authenticated;
revoke all on public.company_withdrawals from anon,authenticated;
revoke all on public.company_withdrawal_allocations from anon,authenticated;
grant select on public.company_balance_entries to authenticated;
grant select on public.company_withdrawals to authenticated;
grant select on public.company_withdrawal_allocations to authenticated;
grant all privileges on public.company_balance_entries to service_role;
grant all privileges on public.company_withdrawals to service_role;
grant all privileges on public.company_withdrawal_allocations to service_role;

drop policy if exists company_balance_read_scope on public.company_balance_entries;
create policy company_balance_read_scope on public.company_balance_entries
for select to authenticated using(
  company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only')
);

drop policy if exists company_withdrawals_read_scope on public.company_withdrawals;
create policy company_withdrawals_read_scope on public.company_withdrawals
for select to authenticated using(
  company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only')
);

drop policy if exists company_withdrawal_allocations_read_scope on public.company_withdrawal_allocations;
create policy company_withdrawal_allocations_read_scope on public.company_withdrawal_allocations
for select to authenticated using(
  exists(
    select 1 from public.company_withdrawals w
    where w.id=withdrawal_id
      and (w.company_id=public.current_company_id() or public.master_has_company_access(w.company_id,'read_only'))
  )
);

create or replace function public.sync_company_balance_from_payout_item()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_amount bigint;
  v_state text;
  v_existing_state text;
  v_charge text;
begin
  v_amount:=greatest(0,round(coalesce(new.transfer_amount,0)*100)::bigint);
  if v_amount<1 then return new; end if;

  select state into v_existing_state
  from public.company_balance_entries
  where payout_item_id=new.id;

  if v_existing_state='paid_out' then return new; end if;

  v_state:=case new.status::text
    when 'pending_feedback' then 'pending'
    when 'held_task' then 'hold'
    when 'eligible' then 'release_ready'
    when 'approved' then 'release_ready'
    when 'transferred' then 'available'
    when 'refunded' then 'reversed'
    when 'disputed' then 'disputed'
    when 'cancelled' then 'cancelled'
    else coalesce(v_existing_state,'pending')
  end;

  select stripe_charge_id into v_charge
  from public.payments
  where id=new.payment_id;

  insert into public.company_balance_entries(
    company_id,payout_item_id,payment_id,invoice_id,customer_id,property_id,visit_id,
    amount_cents,currency,state,hold_reason,stripe_charge_id,stripe_transfer_id,
    stripe_transfer_created_at,released_at,updated_at
  ) values(
    new.company_id,new.id,new.payment_id,new.invoice_id,new.customer_id,new.property_id,new.visit_id,
    v_amount,'cad',v_state,new.hold_reason,v_charge,new.stripe_transfer_id,
    case when new.stripe_transfer_id is not null then coalesce(new.transferred_at,now()) else null end,
    case when v_state='available' then coalesce(new.transferred_at,now()) else null end,
    now()
  )
  on conflict(payout_item_id) do update set
    payment_id=excluded.payment_id,
    invoice_id=excluded.invoice_id,
    customer_id=excluded.customer_id,
    property_id=excluded.property_id,
    visit_id=excluded.visit_id,
    amount_cents=case when public.company_balance_entries.paid_out_cents=0 and public.company_balance_entries.reserved_cents=0 then excluded.amount_cents else public.company_balance_entries.amount_cents end,
    state=case when public.company_balance_entries.state='paid_out' then 'paid_out' else excluded.state end,
    hold_reason=excluded.hold_reason,
    stripe_charge_id=coalesce(public.company_balance_entries.stripe_charge_id,excluded.stripe_charge_id),
    stripe_transfer_id=coalesce(public.company_balance_entries.stripe_transfer_id,excluded.stripe_transfer_id),
    stripe_transfer_created_at=coalesce(public.company_balance_entries.stripe_transfer_created_at,excluded.stripe_transfer_created_at),
    released_at=coalesce(public.company_balance_entries.released_at,excluded.released_at),
    updated_at=now();
  return new;
end $$;

revoke all on function public.sync_company_balance_from_payout_item() from public,anon,authenticated;
grant execute on function public.sync_company_balance_from_payout_item() to service_role;

drop trigger if exists payout_item_syncs_company_balance on public.company_payout_items;
create trigger payout_item_syncs_company_balance
after insert or update of status,transfer_amount,stripe_transfer_id,hold_reason on public.company_payout_items
for each row execute function public.sync_company_balance_from_payout_item();

insert into public.company_balance_entries(
  company_id,payout_item_id,payment_id,invoice_id,customer_id,property_id,visit_id,
  amount_cents,currency,state,hold_reason,stripe_charge_id,stripe_transfer_id,
  stripe_transfer_created_at,released_at
)
select
  p.company_id,p.id,p.payment_id,p.invoice_id,p.customer_id,p.property_id,p.visit_id,
  round(p.transfer_amount*100)::bigint,'cad',
  case p.status::text
    when 'pending_feedback' then 'pending'
    when 'held_task' then 'hold'
    when 'eligible' then 'release_ready'
    when 'approved' then 'release_ready'
    when 'transferred' then 'available'
    when 'refunded' then 'reversed'
    when 'disputed' then 'disputed'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end,
  p.hold_reason,pay.stripe_charge_id,p.stripe_transfer_id,
  case when p.stripe_transfer_id is not null then coalesce(p.transferred_at,p.created_at) else null end,
  case when p.status::text='transferred' then coalesce(p.transferred_at,p.created_at) else null end
from public.company_payout_items p
left join public.payments pay on pay.id=p.payment_id
where coalesce(p.transfer_amount,0)>0
on conflict(payout_item_id) do nothing;

create or replace function public.reserve_company_withdrawal(
  p_company_id uuid,
  p_amount_cents bigint,
  p_requested_by uuid default null,
  p_system_generated boolean default false
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_withdrawal uuid;
  v_available bigint;
  v_remaining bigint;
  v_row record;
  v_piece bigint;
begin
  if p_company_id is null or coalesce(p_amount_cents,0)<1 then raise exception 'Invalid withdrawal request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));

  select coalesce(sum(amount_cents-paid_out_cents-reserved_cents),0)::bigint
  into v_available
  from public.company_balance_entries
  where company_id=p_company_id and state='available';

  if p_amount_cents>v_available then
    raise exception 'Withdrawal exceeds internal available balance';
  end if;

  insert into public.company_withdrawals(
    company_id,requested_by_profile_id,amount_cents,status,system_generated,
    internal_available_cents_at_request
  ) values(
    p_company_id,p_requested_by,p_amount_cents,'reserved',coalesce(p_system_generated,false),v_available
  ) returning id into v_withdrawal;

  v_remaining:=p_amount_cents;
  for v_row in
    select id,amount_cents,paid_out_cents,reserved_cents
    from public.company_balance_entries
    where company_id=p_company_id
      and state='available'
      and amount_cents-paid_out_cents-reserved_cents>0
    order by released_at nulls last,created_at,id
    for update
  loop
    exit when v_remaining<=0;
    v_piece:=least(v_remaining,v_row.amount_cents-v_row.paid_out_cents-v_row.reserved_cents);
    update public.company_balance_entries
      set reserved_cents=reserved_cents+v_piece,updated_at=now()
      where id=v_row.id;
    insert into public.company_withdrawal_allocations(withdrawal_id,balance_entry_id,amount_cents)
      values(v_withdrawal,v_row.id,v_piece);
    v_remaining:=v_remaining-v_piece;
  end loop;

  if v_remaining<>0 then raise exception 'Could not reserve the requested company balance'; end if;
  return v_withdrawal;
end $$;

create or replace function public.release_company_withdrawal_reservation(
  p_withdrawal_id uuid,
  p_failure_code text default null,
  p_failure_message text default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_w public.company_withdrawals%rowtype;
  v_alloc record;
begin
  select * into v_w from public.company_withdrawals where id=p_withdrawal_id for update;
  if v_w.id is null or v_w.status not in('reserved','processing') then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_w.company_id::text,0));
  for v_alloc in select * from public.company_withdrawal_allocations where withdrawal_id=v_w.id loop
    update public.company_balance_entries
      set reserved_cents=greatest(0,reserved_cents-v_alloc.amount_cents),updated_at=now()
      where id=v_alloc.balance_entry_id;
  end loop;
  update public.company_withdrawals
    set status='failed',failure_code=p_failure_code,failure_message=left(p_failure_message,800),processed_at=now(),updated_at=now()
    where id=v_w.id;
end $$;

create or replace function public.complete_company_withdrawal(
  p_withdrawal_id uuid,
  p_stripe_payout_id text
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_w public.company_withdrawals%rowtype;
  v_alloc record;
begin
  select * into v_w from public.company_withdrawals where id=p_withdrawal_id for update;
  if v_w.id is null then raise exception 'Withdrawal not found'; end if;
  if v_w.status='paid' then return; end if;
  if v_w.status not in('reserved','processing') then raise exception 'Withdrawal is not payable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_w.company_id::text,0));
  for v_alloc in select * from public.company_withdrawal_allocations where withdrawal_id=v_w.id loop
    update public.company_balance_entries
      set reserved_cents=greatest(0,reserved_cents-v_alloc.amount_cents),
          paid_out_cents=paid_out_cents+v_alloc.amount_cents,
          state=case when paid_out_cents+v_alloc.amount_cents>=amount_cents then 'paid_out' else 'available' end,
          updated_at=now()
      where id=v_alloc.balance_entry_id;
  end loop;
  update public.company_withdrawals
    set status='paid',stripe_payout_id=coalesce(p_stripe_payout_id,stripe_payout_id),paid_at=now(),processed_at=now(),updated_at=now()
    where id=v_w.id;
end $$;

create or replace function public.master_release_company_balance_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and active and role::text='master'
  ) then raise exception 'Only Master can manually release company balance'; end if;
  update public.company_balance_entries
    set state='release_ready',hold_reason='Released manually by Master',updated_at=now()
    where id=p_entry_id and state in('pending','hold');
end $$;

revoke all on function public.reserve_company_withdrawal(uuid,bigint,uuid,boolean) from public,anon,authenticated;
revoke all on function public.release_company_withdrawal_reservation(uuid,text,text) from public,anon,authenticated;
revoke all on function public.complete_company_withdrawal(uuid,text) from public,anon,authenticated;
revoke all on function public.master_release_company_balance_entry(uuid) from public,anon;
grant execute on function public.reserve_company_withdrawal(uuid,bigint,uuid,boolean) to service_role;
grant execute on function public.release_company_withdrawal_reservation(uuid,text,text) to service_role;
grant execute on function public.complete_company_withdrawal(uuid,text) to service_role;
grant execute on function public.master_release_company_balance_entry(uuid) to authenticated;

-- Weekly batch payout is superseded by the receivables balance + on-demand withdrawal model.
update public.company_payout_batches
set status='cancelled'
where status in('draft','approved','processing');
revoke execute on function public.generate_company_weekly_payout_batch(uuid,date) from authenticated;

-- Canonical commercial rules: weekly/biweekly/custom = per Visit; monthly = one period charge.
create or replace function public.save_customer_billing_agreement(
  p_job_id uuid,
  p_billing_model text,
  p_collection_timing text,
  p_service_frequency text,
  p_customer_amount_cents bigint,
  p_provider_payout_cents bigint default null,
  p_platform_fee_basis_points integer default null,
  p_contract_starts_on date default current_date,
  p_contract_ends_on date default null,
  p_feedback_window_hours integer default 24,
  p_prepaid_plan_type text default null,
  p_plan_billing_day integer default 1,
  p_service_start_day integer default null,
  p_custom_frequency_interval integer default null,
  p_custom_frequency_unit text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_property public.properties%rowtype;
  v_owner text;
  v_model text;
  v_collection text;
  v_prepaid text;
  v_billing_type text;
  v_fee integer:=p_platform_fee_basis_points;
  v_provider bigint:=p_provider_payout_cents;
  v_tax integer;
  v_tax_label text;
  v_province text;
  v_version integer;
  v_id uuid;
begin
  select * into v_profile from public.profiles where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;
  if v_profile.role::text='manager' then perform public.require_company_module_permission('finance','manage'); end if;

  select * into v_job from public.jobs where id=p_job_id and active=true;
  if v_job.id is null then raise exception 'Active job not found'; end if;
  select * into v_customer from public.customers where id=v_job.customer_id and archived_at is null;
  if v_customer.id is null then raise exception 'Customer not found'; end if;
  if v_job.property_id is not null then select * into v_property from public.properties where id=v_job.property_id; end if;

  if v_customer.acquisition_source='platform' then
    if v_profile.role::text<>'master' then raise exception 'Only Master can define a platform customer contract'; end if;
    v_owner:='master';
  else
    if v_profile.role::text not in('admin','manager')
       or coalesce(v_profile.company_id,v_profile.organization_id) is distinct from coalesce(v_customer.origin_company_id,v_customer.company_id,v_customer.organization_id)
    then raise exception 'Only the owning company can define this customer contract'; end if;
    v_owner:='company';
  end if;

  if p_service_frequency not in('one_time','weekly','biweekly','monthly','custom') then raise exception 'Invalid service frequency'; end if;
  if p_customer_amount_cents is null or p_customer_amount_cents<50 then raise exception 'Customer amount must be at least 50 cents'; end if;
  if p_feedback_window_hours<1 or p_feedback_window_hours>168 then raise exception 'Invalid feedback window'; end if;
  if p_contract_ends_on is not null and p_contract_ends_on<p_contract_starts_on then raise exception 'Contract end date cannot be before start date'; end if;

  if p_service_frequency='monthly' then
    v_collection:='period_prepaid';
    v_model:='monthly_fixed_subscription';
    v_prepaid:='monthly';
    v_billing_type:='subscription';
    if coalesce(p_plan_billing_day,0)<1 or p_plan_billing_day>28 then raise exception 'Billing day must be between 1 and 28'; end if;
  elsif p_service_frequency in('weekly','biweekly','custom') then
    v_collection:='after_visit';
    v_model:=case when v_owner='master' then 'per_visit_fixed_payout' else 'per_visit_percentage_fee' end;
    v_prepaid:=null;
    v_billing_type:='pay_per_visit';
  else
    if p_collection_timing='manual' then
      v_collection:='manual';v_model:='manual';v_prepaid:=null;v_billing_type:='prepaid';
    else
      v_collection:='after_visit';
      v_model:=case when v_owner='master' then 'per_visit_fixed_payout' else 'per_visit_percentage_fee' end;
      v_prepaid:=null;v_billing_type:='pay_per_visit';
    end if;
  end if;

  if v_owner='master' and v_model in('per_visit_fixed_payout','monthly_fixed_subscription') then
    if v_provider is null or v_provider<0 or v_provider>p_customer_amount_cents then raise exception 'Company payout must be between zero and customer amount'; end if;
  elsif v_owner='company' and v_model in('per_visit_percentage_fee','monthly_fixed_subscription') then
    if v_fee is null then
      select round(percentage*100)::integer into v_fee
      from public.platform_fee_rules where active and fee_type='percentage'
      order by created_at desc limit 1;
    end if;
    if v_fee is null or v_fee<0 or v_fee>10000 then raise exception 'A valid platform percentage fee is required'; end if;
    v_provider:=round(p_customer_amount_cents::numeric*(10000-v_fee)/10000)::bigint;
  end if;

  v_province:=upper(trim(coalesce(v_property.province,'')));
  case v_province
    when 'ON' then v_tax:=1300;v_tax_label:='HST';
    when 'NS' then v_tax:=1400;v_tax_label:='HST';
    when 'NB' then v_tax:=1500;v_tax_label:='HST';
    when 'NL' then v_tax:=1500;v_tax_label:='HST';
    when 'PE' then v_tax:=1500;v_tax_label:='HST';
    when 'AB' then v_tax:=500;v_tax_label:='GST';
    when 'NT' then v_tax:=500;v_tax_label:='GST';
    when 'NU' then v_tax:=500;v_tax_label:='GST';
    when 'YT' then v_tax:=500;v_tax_label:='GST';
    else v_tax:=null;v_tax_label:=null;
  end case;
  if v_collection<>'manual' and v_tax is null then raise exception 'Automated billing tax configuration is not available for property province %',coalesce(nullif(v_province,''),'unknown'); end if;

  select coalesce(max(version),0)+1 into v_version from public.billing_agreements where job_id=p_job_id;
  update public.billing_agreements set active=false,updated_at=now() where job_id=p_job_id and active=true;

  insert into public.billing_agreements(
    company_id,customer_id,property_id,quote_id,job_id,customer_origin,contract_owner_role,created_by_profile_id,
    billing_model,collection_timing,service_frequency,custom_frequency_interval,custom_frequency_unit,
    customer_amount_cents,provider_payout_cents,platform_fee_basis_points,currency,feedback_window_hours,
    contract_starts_on,contract_ends_on,prepaid_plan_type,plan_billing_day,service_start_day,version,active,
    tax_rate_basis_points,tax_label,ownership_type,payment_status,billing_type,billing_day,
    provider_payout_amount,platform_revenue_amount,stripe_sync_status,stripe_sync_error
  ) values(
    coalesce(v_customer.service_company_id,v_job.company_id,v_job.organization_id),v_customer.id,v_job.property_id,v_job.quote_id,v_job.id,
    case when v_customer.acquisition_source='platform' then 'platform' else 'company' end,v_owner,v_profile.id,
    v_model,v_collection,p_service_frequency,p_custom_frequency_interval,p_custom_frequency_unit,
    p_customer_amount_cents,v_provider,v_fee,'cad',p_feedback_window_hours,p_contract_starts_on,p_contract_ends_on,
    v_prepaid,case when p_service_frequency='monthly' then p_plan_billing_day else 1 end,
    case when p_service_frequency='monthly' then p_service_start_day else null end,v_version,true,v_tax,v_tax_label,v_owner,'active',v_billing_type,
    case when p_service_frequency='monthly' then p_plan_billing_day else 1 end,
    case when v_provider is null then null else round(v_provider::numeric/100,2) end,
    case when v_provider is null then null else round((p_customer_amount_cents-v_provider)::numeric/100,2) end,
    'pending',null
  ) returning id into v_id;

  update public.jobs set
    service_frequency=p_service_frequency,
    billing_model=v_model,
    contract_starts_on=p_contract_starts_on,
    contract_ends_on=p_contract_ends_on,
    feedback_window_hours=p_feedback_window_hours,
    prepaid_plan_type=v_prepaid,
    plan_billing_day=case when p_service_frequency='monthly' then p_plan_billing_day else 1 end,
    service_start_day=case when p_service_frequency='monthly' then p_service_start_day else null end
  where id=p_job_id;

  return v_id;
end $$;

revoke all on function public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text) from public,anon;
grant execute on function public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text) to authenticated;

commit;
