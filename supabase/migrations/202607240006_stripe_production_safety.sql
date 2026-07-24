-- Damasio OS V51.8.5 - Stripe production safety and explicit payout approval.
begin;

create table if not exists public.stripe_webhook_events(
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check(status in('processing','processed','failed')),
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

alter table public.stripe_webhook_events enable row level security;
grant all privileges on table public.stripe_webhook_events to service_role;
revoke all privileges on table public.stripe_webhook_events from anon,authenticated;

create unique index if not exists payments_stripe_payment_intent_unique
  on public.payments(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.company_payout_items
  add column if not exists service_completed_at timestamptz;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='company_payout_items_batch_id_fkey'
      and conrelid='public.company_payout_items'::regclass
  ) then
    alter table public.company_payout_items
      add constraint company_payout_items_batch_id_fkey
      foreign key(batch_id) references public.company_payout_batches(id) on delete set null;
  end if;
end $$;

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
  where v.id=v_item.visit_id
    and coalesce(v.company_id,v.organization_id)=v_item.company_id
    and v.status='completed';

  update public.company_payout_items
    set service_completed_at=v_completed_at,updated_at=now()
    where id=v_item.id;

  if v_completed_at is null then
    update public.company_payout_items
      set status='pending_feedback',
          hold_reason='Waiting for a completed service visit before payout release.',
          eligible_at=null,
          updated_at=now()
      where id=v_item.id;
    return 'pending_feedback';
  end if;

  select count(*) into v_open_tasks
  from public.tasks t
  where coalesce(t.company_id,t.organization_id)=v_item.company_id
    and t.status not in('resolved','cancelled')
    and (
      t.source_visit_id=v_item.visit_id
      or (
        v_item.property_id is not null
        and t.property_id=v_item.property_id
        and t.created_at>=v_completed_at
      )
    );

  if v_open_tasks>0 then
    update public.company_payout_items
      set status='held_task',
          hold_reason='Open customer or Master task is blocking release.',
          eligible_at=null,
          updated_at=now()
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

  if v_positive_feedback is not null or v_completed_at<=now()-interval '3 days' then
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
        eligible_at=null,
        updated_at=now()
    where id=v_item.id;
  return 'pending_feedback';
end $$;

create or replace function public.prepare_company_weekly_payout_batch(
  p_company_id uuid,
  p_reference_date date default current_date
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_week_start date := date_trunc('week',p_reference_date)::date - 7;
  v_week_end date := date_trunc('week',p_reference_date)::date - 1;
  v_scheduled date := public.weekly_company_payout_date(v_week_start);
  v_batch_id uuid;
  v_total numeric(10,2);
  v_item uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated Master required'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text='master') then
    raise exception 'Only Master can prepare payout batches';
  end if;

  for v_item in
    select id from public.company_payout_items
    where company_id=p_company_id
      and status in('pending_feedback','held_task','eligible')
  loop
    perform public.refresh_payout_release_status(v_item);
  end loop;

  insert into public.company_payout_batches(
    company_id,week_start,week_end,scheduled_payout_date,status,total_transfer_amount
  ) values(
    p_company_id,v_week_start,v_week_end,v_scheduled,'draft',0
  )
  on conflict(company_id,week_start,week_end) do update
    set scheduled_payout_date=excluded.scheduled_payout_date
  returning id into v_batch_id;

  update public.company_payout_items
    set batch_id=v_batch_id,updated_at=now()
    where company_id=p_company_id
      and status='eligible'
      and service_completed_at::date between v_week_start and v_week_end
      and (batch_id is null or batch_id=v_batch_id);

  select coalesce(sum(transfer_amount),0) into v_total
  from public.company_payout_items
  where batch_id=v_batch_id and status='eligible';

  update public.company_payout_batches
    set status='draft',
        total_transfer_amount=v_total,
        approved_by_master_id=null,
        approved_at=null
    where id=v_batch_id and status not in('processing','paid');

  return v_batch_id;
end $$;

create or replace function public.approve_company_weekly_payout_batch(p_batch_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_batch public.company_payout_batches%rowtype;
  v_total numeric(10,2);
begin
  if auth.uid() is null then raise exception 'Authenticated Master required'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text='master') then
    raise exception 'Only Master can approve payout batches';
  end if;

  select * into v_batch from public.company_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch not found'; end if;
  if v_batch.status<>'draft' then raise exception 'Only a draft payout batch can be approved'; end if;

  select coalesce(sum(transfer_amount),0) into v_total
  from public.company_payout_items
  where batch_id=p_batch_id and status='eligible';
  if v_total<0.50 then raise exception 'Payout batch has no eligible transfer amount'; end if;

  update public.company_payout_items
    set status='approved',
        approved_by_master_id=auth.uid(),
        approved_at=now(),
        updated_at=now()
    where batch_id=p_batch_id and status='eligible';

  update public.company_payout_batches
    set status='approved',
        total_transfer_amount=v_total,
        approved_by_master_id=auth.uid(),
        approved_at=now()
    where id=p_batch_id;

  return p_batch_id;
end $$;

-- Keep the old RPC safe for older clients: generating now prepares a draft only.
create or replace function public.generate_company_weekly_payout_batch(
  p_company_id uuid,
  p_reference_date date default current_date
) returns uuid language sql security definer set search_path=public as $$
  select public.prepare_company_weekly_payout_batch(p_company_id,p_reference_date)
$$;

revoke all on function public.prepare_company_weekly_payout_batch(uuid,date) from public,anon;
revoke all on function public.approve_company_weekly_payout_batch(uuid) from public,anon;
grant execute on function public.prepare_company_weekly_payout_batch(uuid,date) to authenticated,service_role;
grant execute on function public.approve_company_weekly_payout_batch(uuid) to authenticated,service_role;

commit;
