-- Damasio OS V51.8 - Stripe Connect weekly payout hold ledger.
-- Customers pay the platform. Companies receive weekly transfers after service release checks.
begin;

alter table public.organizations add column if not exists stripe_connected_account_id text;
alter table public.organizations add column if not exists stripe_connect_status text not null default 'not_started'
  check(stripe_connect_status in('not_started','onboarding','restricted','enabled','disabled'));
alter table public.organizations add column if not exists stripe_connect_onboarding_url text;
alter table public.organizations add column if not exists stripe_connect_onboarded_at timestamptz;
alter table public.organizations add column if not exists stripe_payouts_enabled_at timestamptz;

alter table public.invoices add column if not exists stripe_customer_id text;
alter table public.invoices add column if not exists stripe_checkout_session_id text;
alter table public.invoices add column if not exists stripe_payment_intent_id text;
alter table public.invoices add column if not exists stripe_charge_id text;
alter table public.invoices add column if not exists stripe_transfer_group text;
alter table public.invoices add column if not exists stripe_platform_fee numeric(10,2) not null default 0;
alter table public.invoices add column if not exists stripe_transfer_amount numeric(10,2) not null default 0;

alter table public.payments add column if not exists company_id uuid references public.organizations(id) on delete cascade;
update public.payments set company_id=organization_id where company_id is null;
alter table public.payments add column if not exists stripe_checkout_session_id text;
alter table public.payments add column if not exists stripe_payment_intent_id text;
alter table public.payments add column if not exists stripe_charge_id text;
alter table public.payments add column if not exists stripe_transfer_group text;

alter table public.visits add column if not exists payment_release_status text not null default 'not_ready'
  check(payment_release_status in('not_ready','pending_feedback','held_task','eligible','approved','transferred','cancelled'));
alter table public.visits add column if not exists payment_release_eligible_at timestamptz;
alter table public.visits add column if not exists payment_release_reason text;

create table if not exists public.company_payout_items(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  amount_total numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  transfer_amount numeric(10,2) not null default 0,
  status text not null default 'pending_feedback'
    check(status in('pending_feedback','held_task','eligible','approved','transferred','cancelled','refunded','disputed')),
  hold_reason text,
  feedback_id uuid references public.feedback(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  stripe_transfer_group text,
  stripe_transfer_id text,
  eligible_at timestamptz,
  approved_by_master_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  transferred_at timestamptz,
  cancelled_by_master_id uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_payout_batches(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  scheduled_payout_date date not null,
  status text not null default 'draft'
    check(status in('draft','approved','processing','paid','failed','cancelled')),
  stripe_connected_account_id text,
  total_transfer_amount numeric(10,2) not null default 0,
  stripe_transfer_ids text[] not null default '{}',
  approved_by_master_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists company_payout_items_payment_unique
  on public.company_payout_items(payment_id) where payment_id is not null;
create index if not exists company_payout_items_company_status_idx
  on public.company_payout_items(company_id,status,created_at desc);
create index if not exists company_payout_items_eligible_idx
  on public.company_payout_items(company_id,eligible_at) where status='eligible';
create index if not exists company_payout_batches_company_week_idx
  on public.company_payout_batches(company_id,week_start desc);
create unique index if not exists company_payout_batches_company_week_unique
  on public.company_payout_batches(company_id,week_start,week_end);
create index if not exists company_payout_batches_scheduled_idx
  on public.company_payout_batches(scheduled_payout_date,status);
create index if not exists organizations_stripe_connected_account_idx
  on public.organizations(stripe_connected_account_id) where stripe_connected_account_id is not null;

alter table public.company_payout_items enable row level security;
alter table public.company_payout_batches enable row level security;

grant select on table public.company_payout_items to authenticated;
grant select on table public.company_payout_batches to authenticated;
grant all privileges on table public.company_payout_items to service_role;
grant all privileges on table public.company_payout_batches to service_role;

drop policy if exists "company payout items readable by company and master" on public.company_payout_items;
create policy "company payout items readable by company and master" on public.company_payout_items
for select using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'));

drop policy if exists "company payout batches readable by company and master" on public.company_payout_batches;
create policy "company payout batches readable by company and master" on public.company_payout_batches
for select using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'));

create or replace function public.refresh_payout_release_status(p_item_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare
  v_item public.company_payout_items%rowtype;
  v_completed_at timestamptz;
  v_open_tasks integer;
  v_positive_feedback uuid;
begin
  select * into v_item from public.company_payout_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'Payout item not found'; end if;
  if v_item.status in('approved','transferred','cancelled','refunded','disputed') then return v_item.status; end if;

  select coalesce(v.finished_at,v.created_at) into v_completed_at
  from public.visits v
  where v.id=v_item.visit_id and v.company_id=v_item.company_id and v.status='completed';

  select count(*) into v_open_tasks
  from public.tasks t
  where t.company_id=v_item.company_id
    and t.status not in('resolved','cancelled')
    and (
      t.source_visit_id=v_item.visit_id
      or (v_item.property_id is not null and t.property_id=v_item.property_id and t.created_at>=coalesce(v_completed_at,v_item.created_at))
    );

  if v_open_tasks>0 then
    update public.company_payout_items
      set status='held_task', hold_reason='Open customer or Master task is blocking release.', eligible_at=null, updated_at=now()
      where id=v_item.id;
    return 'held_task';
  end if;

  select f.id into v_positive_feedback
  from public.feedback f
  where f.company_id=v_item.company_id and f.visit_id=v_item.visit_id and coalesce(f.rating,0)>=4
  order by f.created_at desc
  limit 1;

  if v_positive_feedback is not null or (v_completed_at is not null and v_completed_at<=now()-interval '3 days') then
    update public.company_payout_items
      set status='eligible',
          feedback_id=coalesce(v_positive_feedback,feedback_id),
          eligible_at=coalesce(eligible_at,now()),
          hold_reason=null,
          updated_at=now()
      where id=v_item.id;
    return 'eligible';
  end if;

  update public.company_payout_items
    set status='pending_feedback',
        hold_reason='Waiting for positive feedback or 3 days without open tasks.',
        updated_at=now()
    where id=v_item.id;
  return 'pending_feedback';
end $$;

revoke all on function public.refresh_payout_release_status(uuid) from public,anon,authenticated;
grant execute on function public.refresh_payout_release_status(uuid) to service_role;

create or replace function public.weekly_company_payout_date(p_work_date date)
returns date language sql immutable as $$
  -- Work week is Monday-Sunday. Payout is the following Friday.
  select (date_trunc('week',p_work_date)::date + interval '11 days')::date
$$;

create or replace function public.weekly_company_payout_week_start(p_work_date date)
returns date language sql immutable as $$
  select date_trunc('week',p_work_date)::date
$$;

create or replace function public.weekly_company_payout_week_end(p_work_date date)
returns date language sql immutable as $$
  select (date_trunc('week',p_work_date)::date + interval '6 days')::date
$$;

create or replace function public.generate_company_weekly_payout_batch(
  p_company_id uuid,
  p_reference_date date default current_date
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_week_start date := date_trunc('week',p_reference_date)::date - interval '7 days';
  v_week_end date := date_trunc('week',p_reference_date)::date - interval '1 day';
  v_scheduled date := public.weekly_company_payout_date(v_week_start);
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
      and status in('pending_feedback','held_task','eligible')
      and created_at::date between v_week_start and v_week_end
  loop
    perform public.refresh_payout_release_status(v_item);
  end loop;

  select coalesce(array_agg(id order by created_at), '{}'), coalesce(sum(transfer_amount),0)
    into v_item_ids, v_total
  from public.company_payout_items
  where company_id=p_company_id
    and status='eligible'
    and created_at::date between v_week_start and v_week_end;

  insert into public.company_payout_batches(company_id,week_start,week_end,scheduled_payout_date,status,total_transfer_amount)
  values(p_company_id,v_week_start,v_week_end,v_scheduled,'draft',v_total)
  on conflict do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select id into v_batch_id
    from public.company_payout_batches
    where company_id=p_company_id and week_start=v_week_start and week_end=v_week_end
    order by created_at desc
    limit 1;
    update public.company_payout_batches
      set scheduled_payout_date=v_scheduled,total_transfer_amount=v_total
      where id=v_batch_id and status='draft';
  end if;

  if coalesce(array_length(v_item_ids,1),0)>0 then
    update public.company_payout_items
      set status='approved', approved_by_master_id=auth.uid(), approved_at=now(), updated_at=now()
      where id=any(v_item_ids) and status='eligible';
    update public.company_payout_batches
      set status='approved', approved_by_master_id=auth.uid(), approved_at=now(), total_transfer_amount=v_total
      where id=v_batch_id and status='draft';
  end if;

  return v_batch_id;
end $$;

revoke all on function public.weekly_company_payout_date(date) from public,anon;
revoke all on function public.weekly_company_payout_week_start(date) from public,anon;
revoke all on function public.weekly_company_payout_week_end(date) from public,anon;
revoke all on function public.generate_company_weekly_payout_batch(uuid,date) from public,anon,authenticated;
grant execute on function public.weekly_company_payout_date(date) to authenticated;
grant execute on function public.weekly_company_payout_week_start(date) to authenticated;
grant execute on function public.weekly_company_payout_week_end(date) to authenticated;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to authenticated;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to service_role;

commit;
