alter table public.visit_billing_events
  drop constraint if exists visit_billing_events_stripe_transfer_id_key;

create index if not exists visit_billing_events_stripe_transfer_idx
  on public.visit_billing_events(stripe_transfer_id)
  where stripe_transfer_id is not null;

create or replace function public.reconcile_visit_payment_to_payout()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.invoices%rowtype;
  v_event public.visit_billing_events%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_transfer numeric;
  v_fee numeric;
  v_existing uuid;
  v_completed_at timestamptz;
begin
  if new.status::text<>'paid'
    or new.invoice_id is null
    or new.method::text<>'credit_card'
    or nullif(trim(coalesce(new.stripe_payment_intent_id,'')),'') is null
  then
    return new;
  end if;

  select * into v_invoice
  from public.invoices
  where id=new.invoice_id;

  if v_invoice.id is null or v_invoice.billing_event_id is null then
    return new;
  end if;

  select * into v_event
  from public.visit_billing_events
  where id=v_invoice.billing_event_id
  for update;

  if v_event.id is null then
    raise exception 'Visit billing event not found for paid invoice';
  end if;

  select * into v_agreement
  from public.billing_agreements
  where id=v_event.billing_agreement_id;

  if v_agreement.id is null then
    raise exception 'Billing agreement not found for paid Visit';
  end if;

  if abs(new.amount-v_invoice.total)>0.009 then
    raise exception 'Paid amount does not match Visit invoice';
  end if;

  if coalesce(v_agreement.provider_payout_cents,-1)<0
    or v_agreement.provider_payout_cents>v_agreement.customer_amount_cents
  then
    raise exception 'Billing agreement provider payout is invalid';
  end if;

  v_transfer:=round(v_agreement.provider_payout_cents::numeric/100,2);
  v_fee:=round(new.amount-v_transfer,2);
  v_completed_at:=v_event.visit_completed_at;

  select id into v_existing
  from public.company_payout_items
  where payment_id=new.id
  limit 1;

  if v_existing is null then
    insert into public.company_payout_items(
      company_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,
      amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,
      stripe_transfer_group,service_completed_at
    ) values(
      v_event.company_id,v_invoice.id,new.id,v_event.job_id,v_event.visit_id,
      v_event.customer_id,v_event.property_id,new.amount,v_fee,v_transfer,
      'eligible',null,clock_timestamp(),new.stripe_transfer_group,v_completed_at
    );
  end if;

  update public.invoices
  set stripe_platform_fee=v_fee,
      stripe_transfer_amount=v_transfer,
      stripe_transfer_group=coalesce(new.stripe_transfer_group,stripe_transfer_group)
  where id=v_invoice.id;

  update public.visit_billing_events
  set state='charged',
      charged_at=coalesce(charged_at,clock_timestamp()),
      stripe_payment_intent_id=coalesce(stripe_payment_intent_id,new.stripe_payment_intent_id),
      stripe_charge_id=coalesce(stripe_charge_id,new.stripe_charge_id),
      updated_at=clock_timestamp()
  where id=v_event.id
    and state in('release_pending','charge_processing','charge_failed','charged');

  return new;
end;
$function$;

create or replace function public.sync_visit_billing_from_payout()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
begin
  if new.invoice_id is null then
    return new;
  end if;

  select billing_event_id
  into v_event_id
  from public.invoices
  where id=new.invoice_id;

  if v_event_id is null then
    return new;
  end if;

  if new.status='transferred' then
    update public.visit_billing_events
    set state='transferred',
        transferred_at=coalesce(new.transferred_at,clock_timestamp()),
        stripe_transfer_id=new.stripe_transfer_id,
        updated_at=clock_timestamp()
    where id=v_event_id;
  elsif new.status='refunded' then
    update public.visit_billing_events
    set state='refunded',
        updated_at=clock_timestamp()
    where id=v_event_id;
  elsif new.status='disputed' then
    update public.visit_billing_events
    set state='refund_pending',
        updated_at=clock_timestamp()
    where id=v_event_id;
  end if;

  return new;
end;
$function$;

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
begin
  select * into v_item
  from public.company_payout_items
  where id=p_item_id
  for update;

  if v_item.id is null then
    raise exception 'Payout item not found';
  end if;

  if v_item.status in('approved','transferred','cancelled','refunded','disputed') then
    return v_item.status;
  end if;

  if v_item.invoice_id is not null then
    select i.billing_event_id
    into v_event_id
    from public.invoices i
    where i.id=v_item.invoice_id;
  end if;

  if v_event_id is not null then
    select be.state,be.visit_completed_at
    into v_event_state,v_completed_at
    from public.visit_billing_events be
    where be.id=v_event_id;

    select count(*) into v_open_tasks
    from public.tasks t
    where coalesce(t.company_id,t.organization_id)=v_item.company_id
      and t.source_visit_id=v_item.visit_id
      and t.status::text not in('resolved','cancelled','completed');

    if v_open_tasks>0 then
      update public.company_payout_items
      set status='held_task',
          hold_reason='Open Visit task is blocking release.',
          eligible_at=null,
          service_completed_at=v_completed_at,
          updated_at=clock_timestamp()
      where id=v_item.id;
      return 'held_task';
    end if;

    if v_event_state in('charged','transfer_pending','transferred') then
      update public.company_payout_items
      set status=case when v_item.status='transferred' then 'transferred' else 'eligible' end,
          hold_reason=null,
          eligible_at=coalesce(eligible_at,clock_timestamp()),
          service_completed_at=v_completed_at,
          updated_at=clock_timestamp()
      where id=v_item.id;

      return case when v_item.status='transferred' then 'transferred' else 'eligible' end;
    end if;

    update public.company_payout_items
    set status='pending_feedback',
        hold_reason='Visit billing event is not charge-complete.',
        eligible_at=null,
        service_completed_at=v_completed_at,
        updated_at=clock_timestamp()
    where id=v_item.id;
    return 'pending_feedback';
  end if;

  select coalesce(v.finished_at,v.created_at)
  into v_completed_at
  from public.visits v
  where v.id=v_item.visit_id
    and coalesce(v.company_id,v.organization_id)=v_item.company_id
    and v.status='completed';

  update public.company_payout_items
  set service_completed_at=v_completed_at,
      updated_at=clock_timestamp()
  where id=v_item.id;

  if v_completed_at is null then
    update public.company_payout_items
    set status='pending_feedback',
        hold_reason='Waiting for a completed service visit before payout release.',
        eligible_at=null,
        updated_at=clock_timestamp()
    where id=v_item.id;
    return 'pending_feedback';
  end if;

  select count(*) into v_open_tasks
  from public.tasks t
  where coalesce(t.company_id,t.organization_id)=v_item.company_id
    and t.status::text not in('resolved','cancelled','completed')
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

  if v_positive_feedback is not null
    or v_completed_at<=clock_timestamp()-interval '3 days'
  then
    update public.company_payout_items
    set status='eligible',
        feedback_id=coalesce(v_positive_feedback,feedback_id),
        eligible_at=coalesce(eligible_at,clock_timestamp()),
        hold_reason=null,
        updated_at=clock_timestamp()
    where id=v_item.id;
    return 'eligible';
  end if;

  update public.company_payout_items
  set status='pending_feedback',
      hold_reason='Waiting for positive feedback or 3 days without open tasks.',
      eligible_at=null,
      updated_at=clock_timestamp()
  where id=v_item.id;

  return 'pending_feedback';
end;
$function$;

revoke all on function public.reconcile_visit_payment_to_payout() from public,anon,authenticated;
revoke all on function public.sync_visit_billing_from_payout() from public,anon,authenticated;

drop trigger if exists payment_reconciles_visit_payout on public.payments;
create trigger payment_reconciles_visit_payout
after insert or update of status on public.payments
for each row
execute function public.reconcile_visit_payment_to_payout();

drop trigger if exists payout_syncs_visit_billing on public.company_payout_items;
create trigger payout_syncs_visit_billing
after update of status,stripe_transfer_id on public.company_payout_items
for each row
execute function public.sync_visit_billing_from_payout();
