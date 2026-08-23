-- Monthly recurring billing hardening.
-- Recurring customers are billed once per month; Visits remain operational proof and payout-release signals.

alter type public.invoice_status add value if not exists 'refunded';

alter table public.invoices
  add column if not exists billing_cycle_id uuid references public.billing_cycles(id) on delete set null;

create unique index if not exists invoices_billing_cycle_unique
  on public.invoices(billing_cycle_id)
  where billing_cycle_id is not null;

create index if not exists invoices_customer_created_idx
  on public.invoices(customer_id, created_at desc);

alter table public.customer_payment_profiles
  add column if not exists stripe_payment_method_id text,
  add column if not exists last_payment_attempt_at timestamptz,
  add column if not exists last_payment_error text;

create index if not exists customer_payment_profiles_stripe_customer_idx
  on public.customer_payment_profiles(stripe_customer_id)
  where stripe_customer_id is not null;

-- Stop legacy recurring contracts from producing another per-Visit charge.
-- They stay visible so an operator can resave the commercial terms as a monthly agreement.
update public.billing_agreements
set payment_status='hold',
    stripe_sync_status='pending',
    stripe_sync_error='Recurring agreement must be resaved as monthly billing before customer collection resumes.',
    updated_at=clock_timestamp()
where active
  and collection_timing='after_visit'
  and service_frequency in ('weekly','biweekly','monthly','custom');

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
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_property public.properties%rowtype;
  v_owner_role text;
  v_next_version integer;
  v_agreement_id uuid;
  v_fee_bps integer := p_platform_fee_basis_points;
  v_provider_payout_cents bigint := p_provider_payout_cents;
  v_tax_bps integer;
  v_tax_label text;
  v_province text;
  v_billing_type text;
  v_prepaid_plan_type text;
begin
  select * into v_profile
  from public.profiles
  where id=auth.uid() and active=true;

  if v_profile.id is null then raise exception 'Authentication required'; end if;

  if v_profile.role::text='manager' then
    perform public.require_company_module_permission('finance','manage');
  end if;

  select * into v_job from public.jobs where id=p_job_id and active=true;
  if v_job.id is null then raise exception 'Active job not found'; end if;

  select * into v_customer
  from public.customers
  where id=v_job.customer_id and archived_at is null;
  if v_customer.id is null then raise exception 'Customer not found'; end if;

  if v_job.property_id is not null then
    select * into v_property from public.properties where id=v_job.property_id;
  end if;

  if v_customer.acquisition_source='platform' then
    if v_profile.role::text<>'master' then
      raise exception 'Only Master can define a platform customer contract';
    end if;
    v_owner_role:='master';
  else
    if v_profile.role::text not in('admin','manager')
      or coalesce(v_profile.company_id,v_profile.organization_id)
        is distinct from coalesce(v_customer.origin_company_id,v_customer.company_id,v_customer.organization_id)
    then
      raise exception 'Only the owning company can define this customer contract';
    end if;
    v_owner_role:='company';
  end if;

  if p_service_frequency not in('one_time','weekly','biweekly','monthly','custom') then
    raise exception 'Invalid service frequency';
  end if;
  if p_feedback_window_hours<1 or p_feedback_window_hours>168 then
    raise exception 'Invalid feedback window';
  end if;
  if p_customer_amount_cents is null or p_customer_amount_cents<50 then
    raise exception 'Customer amount must be at least 50 cents';
  end if;
  if p_contract_ends_on is not null and p_contract_ends_on<p_contract_starts_on then
    raise exception 'Contract end date cannot be before start date';
  end if;
  if coalesce(p_plan_billing_day,0)<1 or p_plan_billing_day>28 then
    raise exception 'Billing day must be between 1 and 28';
  end if;

  if p_collection_timing='period_prepaid' then
    if p_service_frequency='one_time' then
      raise exception 'One-time services cannot use recurring monthly billing';
    end if;
    if p_billing_model<>'monthly_fixed_subscription' then
      raise exception 'Recurring service collection uses the monthly fixed subscription model';
    end if;
    if p_prepaid_plan_type is not null and p_prepaid_plan_type<>'monthly' then
      raise exception 'Recurring customer collection is monthly';
    end if;
    v_billing_type:='subscription';
    v_prepaid_plan_type:='monthly';
  elsif p_collection_timing='after_visit' then
    if p_service_frequency<>'one_time' then
      raise exception 'Recurring services are billed monthly, not after each Visit';
    end if;
    if p_billing_model not in('per_visit_fixed_payout','per_visit_percentage_fee') then
      raise exception 'One-time after-service collection requires a supported one-time billing model';
    end if;
    v_billing_type:='pay_per_visit';
    v_prepaid_plan_type:=null;
  elsif p_collection_timing='manual' then
    if p_billing_model<>'manual' then
      raise exception 'Manual collection requires the manual billing model';
    end if;
    v_billing_type:='prepaid';
    v_prepaid_plan_type:=null;
  else
    raise exception 'Invalid collection timing';
  end if;

  if p_billing_model='per_visit_fixed_payout'
     or (p_billing_model='monthly_fixed_subscription' and v_owner_role='master') then
    if v_provider_payout_cents is null
      or v_provider_payout_cents<0
      or v_provider_payout_cents>p_customer_amount_cents
    then
      raise exception 'Company payout must be between zero and the customer amount';
    end if;
  end if;

  if p_billing_model='per_visit_percentage_fee'
     or (p_billing_model='monthly_fixed_subscription' and v_owner_role='company') then
    if v_fee_bps is null then
      select round(pfr.percentage*100)::integer
      into v_fee_bps
      from public.platform_fee_rules pfr
      where pfr.active and pfr.fee_type='percentage'
      order by pfr.created_at desc
      limit 1;
    end if;
    if v_fee_bps is null or v_fee_bps<0 or v_fee_bps>10000 then
      raise exception 'A valid platform percentage fee is required';
    end if;
    v_provider_payout_cents:=round(p_customer_amount_cents::numeric*(10000-v_fee_bps)/10000)::bigint;
  end if;

  v_province:=upper(trim(coalesce(v_property.province,'')));
  case v_province
    when 'ON' then v_tax_bps:=1300; v_tax_label:='HST';
    when 'NS' then v_tax_bps:=1400; v_tax_label:='HST';
    when 'NB' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'NL' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'PE' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'AB' then v_tax_bps:=500; v_tax_label:='GST';
    when 'NT' then v_tax_bps:=500; v_tax_label:='GST';
    when 'NU' then v_tax_bps:=500; v_tax_label:='GST';
    when 'YT' then v_tax_bps:=500; v_tax_label:='GST';
    else v_tax_bps:=null; v_tax_label:=null;
  end case;

  if p_collection_timing<>'manual' and v_tax_bps is null then
    raise exception 'Automated billing tax configuration is not available for property province %; use manual collection',
      coalesce(nullif(v_province,''),'unknown');
  end if;

  select coalesce(max(version),0)+1 into v_next_version
  from public.billing_agreements where job_id=p_job_id;

  update public.billing_agreements
  set active=false,updated_at=clock_timestamp()
  where job_id=p_job_id and active=true;

  insert into public.billing_agreements(
    company_id,customer_id,property_id,quote_id,job_id,customer_origin,
    contract_owner_role,created_by_profile_id,billing_model,collection_timing,
    service_frequency,custom_frequency_interval,custom_frequency_unit,
    customer_amount_cents,provider_payout_cents,platform_fee_basis_points,
    currency,feedback_window_hours,contract_starts_on,contract_ends_on,
    prepaid_plan_type,plan_billing_day,service_start_day,version,active,
    tax_rate_basis_points,tax_label,ownership_type,payment_status,
    billing_type,billing_day,provider_payout_amount,platform_revenue_amount,
    stripe_sync_status,stripe_sync_error
  ) values(
    coalesce(v_customer.service_company_id,v_job.company_id,v_job.organization_id),
    v_customer.id,v_job.property_id,v_job.quote_id,v_job.id,
    case when v_customer.acquisition_source='platform' then 'platform' else 'company' end,
    v_owner_role,v_profile.id,p_billing_model,p_collection_timing,p_service_frequency,
    p_custom_frequency_interval,p_custom_frequency_unit,p_customer_amount_cents,
    v_provider_payout_cents,v_fee_bps,'cad',p_feedback_window_hours,
    p_contract_starts_on,p_contract_ends_on,v_prepaid_plan_type,p_plan_billing_day,
    p_service_start_day,v_next_version,true,v_tax_bps,v_tax_label,
    case when v_owner_role='master' then 'master' else 'company' end,
    'active',v_billing_type,p_plan_billing_day,
    case when v_provider_payout_cents is null then null else round(v_provider_payout_cents::numeric/100,2) end,
    case when v_provider_payout_cents is null then null else round((p_customer_amount_cents-v_provider_payout_cents)::numeric/100,2) end,
    'pending',null
  ) returning id into v_agreement_id;

  update public.jobs
  set service_frequency=p_service_frequency,
      billing_model=p_billing_model,
      contract_starts_on=p_contract_starts_on,
      contract_ends_on=p_contract_ends_on,
      feedback_window_hours=p_feedback_window_hours,
      prepaid_plan_type=v_prepaid_plan_type,
      plan_billing_day=p_plan_billing_day,
      service_start_day=p_service_start_day
  where id=p_job_id;

  return v_agreement_id;
end;
$function$;

create or replace function public.materialize_monthly_billing_cycle(
  p_agreement_id uuid,
  p_reference_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agreement public.billing_agreements%rowtype;
  v_period_start date;
  v_period_end date;
  v_due date;
  v_service_available date;
  v_cycle_id uuid;
  v_month_key text;
begin
  select * into v_agreement
  from public.billing_agreements
  where id=p_agreement_id
    and active=true
    and payment_status='active'
    and collection_timing='period_prepaid'
    and billing_model='monthly_fixed_subscription'
    and coalesce(prepaid_plan_type,'monthly')='monthly';

  if v_agreement.id is null then return null; end if;

  v_period_start:=date_trunc('month',p_reference_date)::date;
  v_period_end:=(date_trunc('month',p_reference_date)+interval '1 month - 1 day')::date;
  if v_agreement.contract_starts_on is not null and v_agreement.contract_starts_on>v_period_end then return null; end if;
  if v_agreement.contract_ends_on is not null and v_agreement.contract_ends_on<v_period_start then return null; end if;

  v_due:=make_date(extract(year from v_period_start)::int,extract(month from v_period_start)::int,least(coalesce(v_agreement.plan_billing_day,1),28));
  if v_agreement.contract_starts_on is not null and v_agreement.contract_starts_on>v_due then
    v_due:=v_agreement.contract_starts_on;
  end if;

  if v_agreement.service_start_day is null then
    v_service_available:=v_due;
  else
    v_service_available:=make_date(extract(year from v_period_start)::int,extract(month from v_period_start)::int,least(v_agreement.service_start_day,28));
    v_service_available:=greatest(v_due,v_service_available);
  end if;

  v_month_key:=to_char(v_period_start,'YYYY-MM');
  insert into public.billing_cycles(
    billing_agreement_id,company_id,customer_id,property_id,job_id,
    cycle_type,period_starts_on,period_ends_on,charge_due_on,service_available_on,
    state,amount_cents,currency,idempotency_key,updated_at
  ) values(
    v_agreement.id,v_agreement.company_id,v_agreement.customer_id,v_agreement.property_id,v_agreement.job_id,
    'monthly',v_period_start,v_period_end,v_due,v_service_available,
    'scheduled',v_agreement.customer_amount_cents,coalesce(v_agreement.currency,'cad'),
    'monthly:'||v_agreement.id::text||':'||v_month_key,clock_timestamp()
  )
  on conflict (billing_agreement_id,period_starts_on,period_ends_on) do nothing
  returning id into v_cycle_id;

  if v_cycle_id is null then
    select id into v_cycle_id
    from public.billing_cycles
    where billing_agreement_id=v_agreement.id
      and period_starts_on=v_period_start
      and period_ends_on=v_period_end
    limit 1;
  end if;
  return v_cycle_id;
end;
$function$;

create or replace function public.materialize_due_monthly_billing_cycles(
  p_reference_date date default current_date,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agreement record;
  v_cycle record;
  v_generated integer:=0;
  v_invoices integer:=0;
  v_invoice_id uuid;
  v_total numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_rate numeric;
  v_number text;
begin
  for v_agreement in
    select id
    from public.billing_agreements
    where active=true
      and payment_status='active'
      and collection_timing='period_prepaid'
      and billing_model='monthly_fixed_subscription'
      and coalesce(prepaid_plan_type,'monthly')='monthly'
      and (contract_starts_on is null or contract_starts_on<=date_trunc('month',p_reference_date)::date+interval '1 month - 1 day')
      and (contract_ends_on is null or contract_ends_on>=date_trunc('month',p_reference_date)::date)
    order by created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    if public.materialize_monthly_billing_cycle(v_agreement.id,p_reference_date) is not null then
      v_generated:=v_generated+1;
    end if;
  end loop;

  for v_cycle in
    select bc.*,ba.quote_id,ba.tax_rate_basis_points,ba.tax_label
    from public.billing_cycles bc
    join public.billing_agreements ba on ba.id=bc.billing_agreement_id
    left join public.invoices i on i.billing_cycle_id=bc.id
    where bc.cycle_type='monthly'
      and bc.charge_due_on<=p_reference_date
      and bc.state in('scheduled','invoice_pending','payment_failed')
      and i.id is null
    order by bc.charge_due_on,bc.created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    if v_cycle.tax_rate_basis_points is null then
      update public.billing_cycles
      set state='payment_failed',last_error='Verified tax rate is missing.',updated_at=clock_timestamp()
      where id=v_cycle.id;
      continue;
    end if;

    v_total:=round(v_cycle.amount_cents::numeric/100,2);
    v_rate:=v_cycle.tax_rate_basis_points::numeric/10000;
    v_subtotal:=round(v_total/(1+v_rate),2);
    v_tax:=v_total-v_subtotal;
    v_number:='INV-'||to_char(v_cycle.period_starts_on,'YYYYMM')||'-'||upper(substr(replace(v_cycle.id::text,'-',''),1,8));

    insert into public.invoices(
      organization_id,quote_id,customer_id,property_id,invoice_number,status,
      subtotal,tax,total,billing_cycle_id
    ) values(
      v_cycle.company_id,v_cycle.quote_id,v_cycle.customer_id,v_cycle.property_id,
      v_number,'waiting_payment',v_subtotal,v_tax,v_total,v_cycle.id
    )
    on conflict do nothing
    returning id into v_invoice_id;

    if v_invoice_id is null then
      select id into v_invoice_id from public.invoices where billing_cycle_id=v_cycle.id limit 1;
    end if;

    if v_invoice_id is not null then
      update public.billing_cycles
      set state='invoice_pending',last_error=null,updated_at=clock_timestamp()
      where id=v_cycle.id;
      v_invoices:=v_invoices+1;
    end if;
  end loop;

  update public.invoices i
  set status='overdue'
  from public.billing_cycles bc
  where i.billing_cycle_id=bc.id
    and i.status='waiting_payment'
    and bc.charge_due_on<p_reference_date;

  return jsonb_build_object('cycles',v_generated,'invoices',v_invoices,'date',p_reference_date);
end;
$function$;

create or replace function public.sync_monthly_cycle_from_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.billing_cycle_id is null then return new; end if;
  update public.billing_cycles
  set state=case new.status::text
      when 'paid' then 'paid'
      when 'processing' then 'payment_processing'
      when 'refunded' then 'refunded'
      when 'rejected' then 'cancelled'
      when 'overdue' then 'invoice_pending'
      else 'invoice_pending'
    end,
    paid_at=case when new.status::text='paid' then coalesce(paid_at,clock_timestamp()) else paid_at end,
    updated_at=clock_timestamp()
  where id=new.billing_cycle_id;
  return new;
end;
$function$;

drop trigger if exists invoice_syncs_monthly_billing_cycle on public.invoices;
create trigger invoice_syncs_monthly_billing_cycle
after insert or update of status on public.invoices
for each row execute function public.sync_monthly_cycle_from_invoice();

create or replace function public.reconcile_monthly_payment_to_payout()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.invoices%rowtype;
  v_cycle public.billing_cycles%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_transfer_cents bigint;
  v_transfer numeric;
  v_fee numeric;
  v_visit_id uuid;
  v_completed_at timestamptz;
  v_existing uuid;
begin
  if new.invoice_id is null then return new; end if;

  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null or v_invoice.billing_cycle_id is null then return new; end if;
  select * into v_cycle from public.billing_cycles where id=v_invoice.billing_cycle_id for update;
  if v_cycle.id is null then return new; end if;

  if new.status::text='failed' then
    update public.billing_cycles
    set state='payment_failed',last_error=coalesce(new.failure_message,'Monthly payment failed.'),updated_at=clock_timestamp()
    where id=v_cycle.id;
    return new;
  end if;

  if new.status::text<>'paid' then return new; end if;
  if abs(new.amount-v_invoice.total)>0.009 then raise exception 'Paid amount does not match monthly invoice'; end if;

  select * into v_agreement from public.billing_agreements where id=v_cycle.billing_agreement_id;
  if v_agreement.id is null then raise exception 'Billing agreement not found for monthly payment'; end if;

  v_transfer_cents:=coalesce(
    v_agreement.provider_payout_cents,
    round(v_agreement.customer_amount_cents::numeric*(10000-coalesce(v_agreement.platform_fee_basis_points,0))/10000)::bigint
  );
  v_transfer_cents:=greatest(0,least(v_transfer_cents,v_cycle.amount_cents));
  v_transfer:=round(v_transfer_cents::numeric/100,2);
  v_fee:=round(new.amount-v_transfer,2);

  select v.id,coalesce(v.finished_at,v.created_at)
  into v_visit_id,v_completed_at
  from public.visits v
  where v.job_id=v_cycle.job_id
    and coalesce(v.company_id,v.organization_id)=v_cycle.company_id
    and v.status='completed'
    and v.scheduled_date between v_cycle.period_starts_on and v_cycle.period_ends_on
  order by v.scheduled_date desc,coalesce(v.finished_at,v.created_at) desc
  limit 1;

  select id into v_existing from public.company_payout_items where payment_id=new.id limit 1;
  if v_existing is null then
    insert into public.company_payout_items(
      company_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,
      amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,
      stripe_transfer_group,service_completed_at
    ) values(
      v_cycle.company_id,v_invoice.id,new.id,v_cycle.job_id,v_visit_id,v_cycle.customer_id,v_cycle.property_id,
      new.amount,v_fee,v_transfer,'pending_feedback',
      case when v_visit_id is null
        then 'Monthly customer payment received; waiting for a completed service Visit before company payout release.'
        else 'Monthly customer payment received; waiting for Visit feedback/review window.' end,
      null,new.stripe_transfer_group,v_completed_at
    );
  end if;

  update public.invoices
  set stripe_platform_fee=v_fee,
      stripe_transfer_amount=v_transfer,
      stripe_transfer_group=coalesce(new.stripe_transfer_group,stripe_transfer_group)
  where id=v_invoice.id;

  update public.billing_cycles
  set state='paid',stripe_payment_intent_id=coalesce(stripe_payment_intent_id,new.stripe_payment_intent_id),
      paid_at=coalesce(paid_at,clock_timestamp()),last_error=null,updated_at=clock_timestamp()
  where id=v_cycle.id;
  return new;
end;
$function$;

drop trigger if exists payment_reconciles_monthly_payout on public.payments;
create trigger payment_reconciles_monthly_payout
after insert or update of status on public.payments
for each row execute function public.reconcile_monthly_payment_to_payout();

-- Extend the release checker so a monthly payout can attach itself to a completed Visit
-- in its billing period, without turning that Visit into a customer charge.
create or replace function public.refresh_payout_release_status(p_item_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item public.company_payout_items%rowtype;
  v_completed_at timestamptz;
  v_open_tasks integer;
  v_positive_feedback uuid;
  v_event_id uuid;
  v_event_state text;
  v_cycle public.billing_cycles%rowtype;
  v_monthly_visit_id uuid;
begin
  select * into v_item from public.company_payout_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'Payout item not found'; end if;
  if v_item.status in('approved','transferred','cancelled','refunded','disputed') then return v_item.status; end if;

  if v_item.invoice_id is not null then
    select i.billing_event_id into v_event_id from public.invoices i where i.id=v_item.invoice_id;
  end if;

  if v_event_id is not null then
    select be.state,be.visit_completed_at into v_event_state,v_completed_at
    from public.visit_billing_events be where be.id=v_event_id;

    select count(*) into v_open_tasks
    from public.tasks t
    where coalesce(t.company_id,t.organization_id)=v_item.company_id
      and t.source_visit_id=v_item.visit_id
      and t.status::text not in('resolved','cancelled','completed');

    if v_open_tasks>0 then
      update public.company_payout_items
      set status='held_task',hold_reason='Open Visit task is blocking release.',eligible_at=null,
          service_completed_at=v_completed_at,updated_at=clock_timestamp()
      where id=v_item.id;
      return 'held_task';
    end if;

    if v_event_state in('charged','transfer_pending','transferred') then
      update public.company_payout_items
      set status=case when v_item.status='transferred' then 'transferred' else 'eligible' end,
          hold_reason=null,eligible_at=coalesce(eligible_at,clock_timestamp()),
          service_completed_at=v_completed_at,updated_at=clock_timestamp()
      where id=v_item.id;
      return case when v_item.status='transferred' then 'transferred' else 'eligible' end;
    end if;

    update public.company_payout_items
    set status='pending_feedback',hold_reason='Visit billing event is not charge-complete.',eligible_at=null,
        service_completed_at=v_completed_at,updated_at=clock_timestamp()
    where id=v_item.id;
    return 'pending_feedback';
  end if;

  if v_item.invoice_id is not null then
    select bc.* into v_cycle
    from public.invoices i
    join public.billing_cycles bc on bc.id=i.billing_cycle_id
    where i.id=v_item.invoice_id;
  end if;

  if v_cycle.id is not null and v_item.visit_id is null then
    select v.id,coalesce(v.finished_at,v.created_at)
    into v_monthly_visit_id,v_completed_at
    from public.visits v
    where v.job_id=v_cycle.job_id
      and coalesce(v.company_id,v.organization_id)=v_item.company_id
      and v.status='completed'
      and v.scheduled_date between v_cycle.period_starts_on and v_cycle.period_ends_on
    order by v.scheduled_date desc,coalesce(v.finished_at,v.created_at) desc
    limit 1;

    if v_monthly_visit_id is not null then
      update public.company_payout_items
      set visit_id=v_monthly_visit_id,service_completed_at=v_completed_at,updated_at=clock_timestamp()
      where id=v_item.id;
      v_item.visit_id:=v_monthly_visit_id;
    end if;
  end if;

  select coalesce(v.finished_at,v.created_at) into v_completed_at
  from public.visits v
  where v.id=v_item.visit_id
    and coalesce(v.company_id,v.organization_id)=v_item.company_id
    and v.status='completed';

  update public.company_payout_items
  set service_completed_at=v_completed_at,updated_at=clock_timestamp()
  where id=v_item.id;

  if v_completed_at is null then
    update public.company_payout_items
    set status='pending_feedback',
        hold_reason='Waiting for a completed service Visit before payout release.',
        eligible_at=null,updated_at=clock_timestamp()
    where id=v_item.id;
    return 'pending_feedback';
  end if;

  select count(*) into v_open_tasks
  from public.tasks t
  where coalesce(t.company_id,t.organization_id)=v_item.company_id
    and t.status::text not in('resolved','cancelled','completed')
    and (
      t.source_visit_id=v_item.visit_id
      or (v_item.property_id is not null and t.property_id=v_item.property_id and t.created_at>=v_completed_at)
    );

  if v_open_tasks>0 then
    update public.company_payout_items
    set status='held_task',hold_reason='Open customer or Master task is blocking release.',eligible_at=null,
        updated_at=clock_timestamp()
    where id=v_item.id;
    return 'held_task';
  end if;

  select f.id into v_positive_feedback
  from public.feedback f
  where coalesce(f.company_id,f.organization_id)=v_item.company_id
    and f.visit_id=v_item.visit_id
    and coalesce(f.rating,0)>=4
  order by f.created_at desc
  limit 1;

  if v_positive_feedback is not null or v_completed_at<=clock_timestamp()-interval '3 days' then
    update public.company_payout_items
    set status='eligible',feedback_id=coalesce(v_positive_feedback,feedback_id),
        eligible_at=coalesce(eligible_at,clock_timestamp()),hold_reason=null,updated_at=clock_timestamp()
    where id=v_item.id;
    return 'eligible';
  end if;

  update public.company_payout_items
  set status='pending_feedback',
      hold_reason='Waiting for positive feedback or 3 days without open tasks.',
      eligible_at=null,updated_at=clock_timestamp()
  where id=v_item.id;
  return 'pending_feedback';
end;
$function$;

-- Delayed holds must not be lost just because the payout item was created in an older week.
create or replace function public.generate_company_weekly_payout_batch(
  p_company_id uuid,
  p_reference_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_week_start date:=date_trunc('week',p_reference_date)::date-interval '7 days';
  v_week_end date:=date_trunc('week',p_reference_date)::date-interval '1 day';
  v_scheduled date:=public.weekly_company_payout_date(v_week_start);
  v_batch_id uuid;
  v_total numeric(10,2);
  v_item_ids uuid[];
  v_item uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated Master required'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text='master') then
    raise exception 'Only Master can generate payout batches';
  end if;

  for v_item in
    select id from public.company_payout_items
    where company_id=p_company_id
      and batch_id is null
      and status in('pending_feedback','held_task','eligible')
      and created_at::date<=v_week_end
    order by created_at
    limit 2000
  loop
    perform public.refresh_payout_release_status(v_item);
  end loop;

  select coalesce(array_agg(id order by coalesce(eligible_at,created_at),created_at),'{}'),coalesce(sum(transfer_amount),0)
  into v_item_ids,v_total
  from public.company_payout_items
  where company_id=p_company_id
    and batch_id is null
    and status='eligible'
    and coalesce(eligible_at,created_at)::date<=v_week_end;

  insert into public.company_payout_batches(company_id,week_start,week_end,scheduled_payout_date,status,total_transfer_amount)
  values(p_company_id,v_week_start,v_week_end,v_scheduled,'draft',v_total)
  on conflict do nothing returning id into v_batch_id;

  if v_batch_id is null then
    select id into v_batch_id from public.company_payout_batches
    where company_id=p_company_id and week_start=v_week_start and week_end=v_week_end
    order by created_at desc limit 1;
    update public.company_payout_batches
    set scheduled_payout_date=v_scheduled,total_transfer_amount=v_total
    where id=v_batch_id and status='draft';
  end if;

  if coalesce(array_length(v_item_ids,1),0)>0 then
    update public.company_payout_items
    set status='approved',batch_id=v_batch_id,approved_by_master_id=auth.uid(),approved_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=any(v_item_ids) and status='eligible' and batch_id is null;
    update public.company_payout_batches
    set status='approved',approved_by_master_id=auth.uid(),approved_at=clock_timestamp(),total_transfer_amount=v_total
    where id=v_batch_id and status='draft';
  end if;
  return v_batch_id;
end;
$function$;

revoke all on function public.materialize_monthly_billing_cycle(uuid,date) from public,anon,authenticated;
revoke all on function public.materialize_due_monthly_billing_cycles(date,integer) from public,anon,authenticated;
revoke all on function public.sync_monthly_cycle_from_invoice() from public,anon,authenticated;
revoke all on function public.reconcile_monthly_payment_to_payout() from public,anon,authenticated;

grant execute on function public.materialize_monthly_billing_cycle(uuid,date) to service_role;
grant execute on function public.materialize_due_monthly_billing_cycles(date,integer) to service_role;
grant execute on function public.refresh_payout_release_status(uuid) to service_role;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to authenticated;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to service_role;
grant execute on function public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text) to authenticated;
