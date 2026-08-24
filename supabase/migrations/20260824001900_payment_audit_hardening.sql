-- Payment audit hardening: manual invoice terms, delivery tracking and customer dispute release.
begin;

alter table public.invoices
  add column if not exists customer_notification_attempted_at timestamptz,
  add column if not exists customer_notification_error text;

create or replace function public.normalize_company_payout_item_terms()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cycle_agreement uuid;
  v_event_agreement uuid;
  v_invoice_visit uuid;
  v_job uuid;
  v_agreement public.billing_agreements%rowtype;
  v_amount_total numeric;
  v_transfer_cents bigint;
begin
  if new.invoice_id is null then return new; end if;

  select bc.billing_agreement_id, vbe.billing_agreement_id, i.visit_id
    into v_cycle_agreement, v_event_agreement, v_invoice_visit
  from public.invoices i
  left join public.billing_cycles bc on bc.id=i.billing_cycle_id
  left join public.visit_billing_events vbe on vbe.id=i.billing_event_id
  where i.id=new.invoice_id;

  if coalesce(v_cycle_agreement,v_event_agreement) is not null then
    select * into v_agreement
    from public.billing_agreements
    where id=coalesce(v_cycle_agreement,v_event_agreement);
  else
    if coalesce(new.visit_id,v_invoice_visit) is not null then
      select v.job_id into v_job
      from public.visits v
      where v.id=coalesce(new.visit_id,v_invoice_visit)
        and v.customer_id=new.customer_id
      limit 1;
    end if;

    if v_job is not null then
      select * into v_agreement
      from public.billing_agreements ba
      where ba.job_id=v_job
        and ba.active
        and ba.payment_status='active'
      order by ba.version desc,ba.created_at desc
      limit 1;
    end if;
  end if;

  -- Legacy invoices without a canonical agreement must never invent provider terms.
  if v_agreement.id is null then
    new.transfer_amount:=0;
    new.platform_fee:=round(coalesce(new.amount_total,0),2);
    new.hold_reason:=coalesce(new.hold_reason,'Master reconciliation required: no canonical payout terms.');
    return new;
  end if;

  v_amount_total:=coalesce(new.amount_total,0);
  if v_agreement.provider_payout_cents is not null then
    v_transfer_cents:=greatest(0,least(round(v_amount_total*100)::bigint,v_agreement.provider_payout_cents));
  elsif v_agreement.platform_fee_basis_points is not null then
    v_transfer_cents:=greatest(0,round(v_amount_total*100*(10000-v_agreement.platform_fee_basis_points)/10000)::bigint);
  else
    new.transfer_amount:=0;
    new.platform_fee:=round(v_amount_total,2);
    new.hold_reason:=coalesce(new.hold_reason,'Master reconciliation required: billing agreement has no payout terms.');
    return new;
  end if;

  new.transfer_amount:=round(v_transfer_cents::numeric/100,2);
  new.platform_fee:=round(v_amount_total-new.transfer_amount,2);
  return new;
end $$;

revoke all on function public.normalize_company_payout_item_terms() from public,anon,authenticated;
grant execute on function public.normalize_company_payout_item_terms() to service_role;

create or replace function public.open_customer_payment_dispute_protected(
  p_customer_id uuid,
  p_company_id uuid,
  p_visit_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_reason text:=trim(coalesce(p_reason,''));
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_payout public.company_payout_items%rowtype;
  v_request_id uuid;
  v_existing public.service_requests%rowtype;
  v_support_email text;
  v_payout_held boolean:=false;
  v_due timestamptz:=now()+interval '3 days';
begin
  if length(v_reason)<5 then raise exception 'Please explain the payment issue in at least 5 characters.'; end if;

  select * into v_visit
  from public.visits
  where id=p_visit_id
    and customer_id=p_customer_id
    and coalesce(company_id,organization_id)=p_company_id
    and status::text='completed'
  limit 1;
  if not found then raise exception 'Completed Visit was not found for this Customer.'; end if;

  select * into v_invoice
  from public.invoices
  where visit_id=v_visit.id
    and customer_id=p_customer_id
    and organization_id=p_company_id
    and status::text='paid'
  order by created_at desc
  limit 1;
  if not found then raise exception 'No paid invoice is linked to this completed Visit.'; end if;

  select * into v_payment
  from public.payments
  where invoice_id=v_invoice.id
    and customer_id=p_customer_id
    and coalesce(company_id,organization_id)=p_company_id
    and status::text in('paid','succeeded')
  order by paid_at desc nulls last,created_at desc
  limit 1;
  if not found then raise exception 'No successful payment is linked to this invoice.'; end if;

  select * into v_existing
  from public.service_requests
  where customer_id=p_customer_id
    and payment_id=v_payment.id
    and request_type='payment_dispute'
    and status in('pending','open','investigating','company_responded','escalated','overdue')
  limit 1;
  if found then
    select contact_email into v_support_email from public.organizations where id=p_company_id;
    return jsonb_build_object(
      'saved',true,'duplicate',true,'requestId',v_existing.id,'status',v_existing.status,
      'responseDueAt',v_existing.response_due_at,'invoiceId',v_invoice.id,
      'invoiceNumber',v_invoice.invoice_number,'paymentId',v_payment.id,'supportEmail',v_support_email
    );
  end if;

  insert into public.service_requests(
    organization_id,company_id,customer_id,property_id,service_name,message,status,request_type,
    visit_id,invoice_id,payment_id,response_due_at,updated_at
  ) values(
    p_company_id,p_company_id,p_customer_id,v_visit.property_id,
    'Payment dispute · '||coalesce(v_invoice.invoice_number,v_invoice.id::text),
    v_reason,'pending','payment_dispute',v_visit.id,v_invoice.id,v_payment.id,v_due,now()
  ) returning id into v_request_id;

  select * into v_payout
  from public.company_payout_items
  where payment_id=v_payment.id and company_id=p_company_id
  limit 1 for update;

  if found and v_payout.status not in('refunded','cancelled') then
    update public.company_payout_items
    set status='disputed',
        hold_reason='Customer payment dispute open · request '||v_request_id::text,
        eligible_at=null,
        updated_at=now()
    where id=v_payout.id;
    v_payout_held:=true;
  end if;

  select contact_email into v_support_email from public.organizations where id=p_company_id;
  return jsonb_build_object(
    'saved',true,'duplicate',false,'requestId',v_request_id,'visitId',v_visit.id,
    'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,'paymentId',v_payment.id,
    'amount',v_payment.amount,'payoutHeld',v_payout_held,'status','pending',
    'responseDueAt',v_due,'supportEmail',v_support_email
  );
end $$;

revoke all on function public.open_customer_payment_dispute_protected(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.open_customer_payment_dispute_protected(uuid,uuid,uuid,text) to service_role;

create or replace function public.accept_customer_payment_dispute_resolution(
  p_customer_id uuid,
  p_company_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests%rowtype;
  v_payout public.company_payout_items%rowtype;
  v_release_status text;
begin
  select * into v_request
  from public.service_requests
  where id=p_request_id
    and customer_id=p_customer_id
    and company_id=p_company_id
    and request_type='payment_dispute'
  for update;
  if not found then raise exception 'Payment dispute was not found.'; end if;
  if v_request.status='resolved' and v_request.customer_decision='accepted' then
    return jsonb_build_object('saved',true,'status','resolved','duplicate',true);
  end if;
  if v_request.status<>'company_responded' or nullif(trim(coalesce(v_request.company_response,'')),'') is null then
    raise exception 'Wait for the company response before accepting the resolution.';
  end if;

  update public.service_requests
  set status='resolved',customer_decision='accepted',customer_decision_at=now(),updated_at=now()
  where id=v_request.id;

  select * into v_payout
  from public.company_payout_items
  where payment_id=v_request.payment_id and company_id=p_company_id
  limit 1 for update;

  if found and v_payout.status='disputed' then
    if nullif(trim(coalesce(v_payout.stripe_transfer_id,'')),'') is not null then
      update public.company_payout_items
      set status='transferred',hold_reason=null,updated_at=now()
      where id=v_payout.id;
      v_release_status:='transferred';
    else
      update public.company_payout_items
      set status='pending_feedback',hold_reason='Customer accepted dispute resolution; payout safety recheck pending.',updated_at=now()
      where id=v_payout.id;
      v_release_status:=public.refresh_payout_release_status(v_payout.id);
    end if;
  else
    v_release_status:=coalesce(v_payout.status,'none');
  end if;

  return jsonb_build_object('saved',true,'status','resolved','payoutStatus',v_release_status);
end $$;

revoke all on function public.accept_customer_payment_dispute_resolution(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_customer_payment_dispute_resolution(uuid,uuid,uuid) to service_role;

commit;
