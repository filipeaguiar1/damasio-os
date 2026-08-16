alter table public.invoices
  add column if not exists visit_id uuid references public.visits(id) on delete set null;

alter table public.invoices
  add column if not exists billing_event_id uuid references public.visit_billing_events(id) on delete set null;

create unique index if not exists invoices_billing_event_unique
  on public.invoices(billing_event_id)
  where billing_event_id is not null;

create index if not exists invoices_visit_idx
  on public.invoices(visit_id)
  where visit_id is not null;

create or replace function public.materialize_visit_billing_invoice(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.visit_billing_events%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_invoice_id uuid;
  v_total numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_tax_rate numeric;
  v_number text;
begin
  select * into v_event
  from public.visit_billing_events
  where id=p_event_id
  for update;

  if v_event.id is null or v_event.state<>'release_pending' then
    return null;
  end if;

  select * into v_agreement
  from public.billing_agreements
  where id=v_event.billing_agreement_id
    and active
    and payment_status='active';

  if v_agreement.id is null then return null; end if;
  if coalesce(v_agreement.customer_amount_cents,0)<50 then
    raise exception 'Billing agreement has no chargeable customer amount';
  end if;
  if v_agreement.tax_rate_basis_points is null then
    raise exception 'Billing agreement has no verified tax rate';
  end if;

  select id into v_invoice_id
  from public.invoices
  where billing_event_id=v_event.id
  limit 1;

  if v_invoice_id is not null then return v_invoice_id; end if;

  v_total:=round(v_agreement.customer_amount_cents::numeric/100,2);
  v_tax_rate:=v_agreement.tax_rate_basis_points::numeric/10000;
  v_subtotal:=round(v_total/(1+v_tax_rate),2);
  v_tax:=v_total-v_subtotal;
  v_number:='INV-VIS-'||upper(substr(replace(v_event.id::text,'-',''),1,12));

  insert into public.invoices(
    organization_id,quote_id,customer_id,property_id,invoice_number,status,
    subtotal,tax,total,visit_id,billing_event_id
  ) values(
    v_event.company_id,v_agreement.quote_id,v_event.customer_id,v_event.property_id,
    v_number,'waiting_payment',v_subtotal,v_tax,v_total,v_event.visit_id,v_event.id
  )
  on conflict do nothing
  returning id into v_invoice_id;

  if v_invoice_id is null then
    select id into v_invoice_id
    from public.invoices
    where billing_event_id=v_event.id
    limit 1;
  end if;

  return v_invoice_id;
end;
$function$;

create or replace function public.refresh_visit_billing_event(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.visit_billing_events%rowtype;
  v_hours integer;
  v_task_id uuid;
  v_rating integer;
  v_comment text;
  v_effective_deadline timestamptz;
  v_new_task uuid;
begin
  select * into v_event
  from public.visit_billing_events
  where visit_id=p_visit_id
  for update;

  if v_event.id is null then return; end if;
  if v_event.state in('charged','transferred','refund_pending','refunded','cancelled') then return; end if;

  select feedback_window_hours into v_hours
  from public.billing_agreements
  where id=v_event.billing_agreement_id;
  v_hours:=greatest(1,least(coalesce(v_hours,48),168));

  select t.id into v_task_id
  from public.tasks t
  where coalesce(t.company_id,t.organization_id)=v_event.company_id
    and t.source_visit_id=v_event.visit_id
    and t.status::text not in('resolved','cancelled','completed')
  order by t.created_at asc
  limit 1;

  if v_task_id is not null then
    update public.visit_billing_events
    set state='task_hold',
        active_task_id=v_task_id,
        task_hold_started_at=coalesce(task_hold_started_at,clock_timestamp()),
        eligible_to_charge_at=null,
        updated_at=clock_timestamp()
    where id=v_event.id;
    return;
  end if;

  if v_event.state='task_hold' then
    update public.visit_billing_events
    set state='awaiting_feedback',
        active_task_id=null,
        task_resolved_at=clock_timestamp(),
        reopened_feedback_deadline_at=clock_timestamp()+make_interval(hours=>v_hours),
        eligible_to_charge_at=null,
        updated_at=clock_timestamp()
    where id=v_event.id;
    return;
  end if;

  select f.rating,f.comment
  into v_rating,v_comment
  from public.feedback f
  join public.tasks t on t.id=f.task_id
  where t.source_visit_id=v_event.visit_id
  order by f.created_at desc,t.created_at desc
  limit 1;

  if v_rating is null then
    select f.rating,f.comment
    into v_rating,v_comment
    from public.feedback f
    where f.visit_id=v_event.visit_id
    order by f.created_at desc
    limit 1;
  end if;

  if coalesce(v_rating,0)>=4 then
    update public.visit_billing_events
    set state='release_pending',
        eligible_to_charge_at=coalesce(eligible_to_charge_at,clock_timestamp()),
        active_task_id=null,
        updated_at=clock_timestamp()
    where id=v_event.id;
    perform public.materialize_visit_billing_invoice(v_event.id);
    return;
  end if;

  if coalesce(v_rating,0) between 1 and 3 then
    if not exists(
      select 1
      from public.tasks t
      where t.source_visit_id=v_event.visit_id
        and t.title='Customer feedback follow-up'
        and t.status::text not in('resolved','cancelled','completed')
    ) then
      insert into public.tasks(
        organization_id,company_id,customer_id,property_id,source_visit_id,
        title,customer_issue,priority,status
      ) values(
        v_event.company_id,v_event.company_id,v_event.customer_id,v_event.property_id,
        v_event.visit_id,'Customer feedback follow-up',
        coalesce(nullif(trim(v_comment),''),'Customer submitted a low service rating.'),
        'urgent','open'
      ) returning id into v_new_task;
    end if;

    update public.visit_billing_events
    set state='task_hold',
        active_task_id=coalesce(v_new_task,active_task_id),
        task_hold_started_at=coalesce(task_hold_started_at,clock_timestamp()),
        eligible_to_charge_at=null,
        updated_at=clock_timestamp()
    where id=v_event.id;
    return;
  end if;

  v_effective_deadline:=coalesce(v_event.reopened_feedback_deadline_at,v_event.feedback_deadline_at);

  if v_effective_deadline<=clock_timestamp() then
    update public.visit_billing_events
    set state='release_pending',
        eligible_to_charge_at=coalesce(eligible_to_charge_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where id=v_event.id;
    perform public.materialize_visit_billing_invoice(v_event.id);
  else
    update public.visit_billing_events
    set state='awaiting_feedback',
        eligible_to_charge_at=null,
        updated_at=clock_timestamp()
    where id=v_event.id;
  end if;
end;
$function$;

create or replace function public.create_visit_billing_event_after_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agreement public.billing_agreements%rowtype;
  v_completed_at timestamptz;
begin
  if new.status::text<>'completed' or new.job_id is null or new.customer_id is null then
    return new;
  end if;

  select * into v_agreement
  from public.billing_agreements ba
  where ba.job_id=new.job_id
    and ba.active
    and ba.payment_status='active'
    and ba.collection_timing='after_visit'
    and (ba.contract_starts_on is null or new.scheduled_date>=ba.contract_starts_on)
    and (ba.contract_ends_on is null or new.scheduled_date<=ba.contract_ends_on)
  limit 1;

  if v_agreement.id is null then return new; end if;

  v_completed_at:=coalesce(new.finished_at,clock_timestamp());

  insert into public.visit_billing_events(
    company_id,customer_id,property_id,job_id,visit_id,billing_agreement_id,
    state,visit_completed_at,feedback_deadline_at,idempotency_key
  ) values(
    coalesce(new.company_id,new.organization_id,v_agreement.company_id),
    new.customer_id,new.property_id,new.job_id,new.id,v_agreement.id,
    'awaiting_feedback',v_completed_at,
    v_completed_at+make_interval(hours=>v_agreement.feedback_window_hours),
    'visit:'||new.id::text||':agreement:'||v_agreement.id::text
  )
  on conflict(visit_id) do nothing;

  perform public.refresh_visit_billing_event(new.id);
  return new;
end;
$function$;

create or replace function public.refresh_billing_from_feedback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visit uuid;
begin
  v_visit:=new.visit_id;

  if v_visit is null and new.task_id is not null then
    select source_visit_id
    into v_visit
    from public.tasks
    where id=new.task_id;
  end if;

  if v_visit is not null then
    perform public.refresh_visit_billing_event(v_visit);
  end if;

  return new;
end;
$function$;

create or replace function public.refresh_billing_from_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.source_visit_id is not null then
    perform public.refresh_visit_billing_event(new.source_visit_id);
  end if;
  return new;
end;
$function$;

create or replace function public.process_visit_billing_events(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
  v_checked integer:=0;
  v_materialized integer:=0;
  v_invoice uuid;
begin
  for v_row in
    select id,visit_id
    from public.visit_billing_events
    where state in('awaiting_feedback','task_hold','release_pending','charge_failed')
    order by created_at asc
    limit greatest(1,least(coalesce(p_limit,200),1000))
  loop
    perform public.refresh_visit_billing_event(v_row.visit_id);
    v_checked:=v_checked+1;
    v_invoice:=public.materialize_visit_billing_invoice(v_row.id);
    if v_invoice is not null then
      v_materialized:=v_materialized+1;
    end if;
  end loop;

  return jsonb_build_object('checked',v_checked,'materialized',v_materialized);
end;
$function$;

revoke all on function public.materialize_visit_billing_invoice(uuid) from public,anon,authenticated;
revoke all on function public.refresh_visit_billing_event(uuid) from public,anon,authenticated;
revoke all on function public.process_visit_billing_events(integer) from public,anon,authenticated;

grant execute on function public.materialize_visit_billing_invoice(uuid) to service_role;
grant execute on function public.refresh_visit_billing_event(uuid) to service_role;
grant execute on function public.process_visit_billing_events(integer) to service_role;

revoke all on function public.create_visit_billing_event_after_completion() from public,anon,authenticated;
revoke all on function public.refresh_billing_from_feedback() from public,anon,authenticated;
revoke all on function public.refresh_billing_from_task() from public,anon,authenticated;

drop trigger if exists visit_billing_event_on_completed on public.visits;
create trigger visit_billing_event_on_completed
after update of status on public.visits
for each row
when(new.status='completed' and old.status is distinct from new.status)
execute function public.create_visit_billing_event_after_completion();

drop trigger if exists feedback_refreshes_visit_billing on public.feedback;
create trigger feedback_refreshes_visit_billing
after insert or update of rating on public.feedback
for each row
execute function public.refresh_billing_from_feedback();

drop trigger if exists task_refreshes_visit_billing on public.tasks;
create trigger task_refreshes_visit_billing
after insert or update of status on public.tasks
for each row
execute function public.refresh_billing_from_task();
