-- Final Master dispute resolution + full-history receivables totals.
begin;

alter table public.service_requests
  add column if not exists master_outcome text,
  add column if not exists master_reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists master_refund_id text,
  add column if not exists master_refund_requested_at timestamptz;

alter table public.service_requests
  drop constraint if exists service_requests_master_outcome_check;
alter table public.service_requests
  add constraint service_requests_master_outcome_check
  check(master_outcome is null or master_outcome in('company','customer'));

create unique index if not exists service_requests_master_refund_unique
  on public.service_requests(master_refund_id)
  where master_refund_id is not null;
create index if not exists service_requests_refund_pending_idx
  on public.service_requests(company_id,status,updated_at)
  where request_type='payment_dispute' and status='refund_pending';

create or replace function public.company_receivables_summary(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_pending bigint:=0;
  v_available bigint:=0;
  v_processing bigint:=0;
  v_paid_out bigint:=0;
  v_entries bigint:=0;
  v_withdrawals bigint:=0;
begin
  if p_company_id is null or not exists(select 1 from public.organizations where id=p_company_id) then
    raise exception 'Company not found';
  end if;

  select
    coalesce(sum(case when state in('pending','hold','release_ready','transferring') then greatest(0,amount_cents-paid_out_cents-reserved_cents) else 0 end),0)::bigint,
    coalesce(sum(case when state='available' then greatest(0,amount_cents-paid_out_cents-reserved_cents) else 0 end),0)::bigint,
    count(*)::bigint
  into v_pending,v_available,v_entries
  from public.company_balance_entries
  where company_id=p_company_id;

  select
    coalesce(sum(case when status in('reserved','processing') then amount_cents else 0 end),0)::bigint,
    coalesce(sum(case when status='paid' then amount_cents else 0 end),0)::bigint,
    count(*)::bigint
  into v_processing,v_paid_out,v_withdrawals
  from public.company_withdrawals
  where company_id=p_company_id;

  return jsonb_build_object(
    'pendingCents',v_pending,
    'internalAvailableCents',v_available,
    'processingCents',v_processing,
    'paidOutCents',v_paid_out,
    'entryCount',v_entries,
    'withdrawalCount',v_withdrawals
  );
end $$;

revoke all on function public.company_receivables_summary(uuid) from public,anon,authenticated;
grant execute on function public.company_receivables_summary(uuid) to service_role;

create or replace function public.resolve_master_payment_dispute_for_company(
  p_master_id uuid,
  p_request_id uuid,
  p_resolution text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests%rowtype;
  v_payment public.payments%rowtype;
  v_payout public.company_payout_items%rowtype;
  v_resolution text:=trim(coalesce(p_resolution,''));
  v_release_status text:='none';
  v_allowed boolean:=false;
begin
  if p_master_id is null or not exists(select 1 from public.profiles where id=p_master_id and active and role::text='master') then
    raise exception 'Only an active Master can resolve payment disputes';
  end if;
  if length(v_resolution)<5 or length(v_resolution)>1000 then raise exception 'Master resolution must contain 5 to 1000 characters'; end if;

  select * into v_request
  from public.service_requests
  where id=p_request_id and request_type='payment_dispute'
  for update;
  if not found then raise exception 'Payment dispute was not found'; end if;

  if v_request.status='resolved' and v_request.master_outcome='company' then
    return jsonb_build_object('saved',true,'duplicate',true,'status','resolved','outcome','company');
  end if;
  if v_request.status='resolved' then raise exception 'Payment dispute is already resolved'; end if;
  if v_request.status='refund_pending' or v_request.master_outcome='customer' then raise exception 'Customer refund is already in progress'; end if;

  v_allowed:=v_request.status in('escalated','overdue')
    or (v_request.status in('pending','open','investigating') and v_request.response_due_at is not null and v_request.response_due_at<=now());
  if not v_allowed then raise exception 'Master can resolve only an escalated or overdue payment dispute'; end if;

  select * into v_payment from public.payments where id=v_request.payment_id for update;
  if not found then raise exception 'Payment dispute has no canonical payment'; end if;
  if v_payment.status::text not in('paid','succeeded') then raise exception 'Payment is no longer eligible for a company-side resolution'; end if;

  select * into v_payout
  from public.company_payout_items
  where payment_id=v_payment.id and company_id=v_request.company_id
  limit 1 for update;

  if found then
    if v_payout.status in('refunded','cancelled') or coalesce(v_payout.reversed_transfer_amount,0)>0 then
      raise exception 'Payout has already been reversed or cancelled';
    end if;
    if v_payout.status='disputed' then
      if nullif(trim(coalesce(v_payout.stripe_transfer_id,'')),'') is not null then
        update public.company_payout_items
        set status='transferred',hold_reason=null,updated_at=now()
        where id=v_payout.id;
        v_release_status:='transferred';
      else
        update public.company_payout_items
        set status='pending_feedback',hold_reason='Master resolved payment dispute for company; payout safety recheck pending.',eligible_at=null,updated_at=now()
        where id=v_payout.id;
        v_release_status:=public.refresh_payout_release_status(v_payout.id);
      end if;
    else
      v_release_status:=v_payout.status;
    end if;
  end if;

  update public.service_requests
  set status='resolved',
      master_outcome='company',
      master_resolution=v_resolution,
      master_reviewed_by_profile_id=p_master_id,
      master_reviewed_at=now(),
      updated_at=now()
  where id=v_request.id;

  insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(
    p_master_id,v_request.company_id,'payment_dispute.resolved_for_company','service_request',v_request.id,
    jsonb_build_object('payment_id',v_request.payment_id,'invoice_id',v_request.invoice_id,'customer_id',v_request.customer_id,'resolution',v_resolution,'payout_status',v_release_status)
  );

  return jsonb_build_object('saved',true,'status','resolved','outcome','company','payoutStatus',v_release_status);
end $$;

revoke all on function public.resolve_master_payment_dispute_for_company(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_master_payment_dispute_for_company(uuid,uuid,text) to service_role;

create or replace function public.mark_master_payment_dispute_refund_pending(
  p_master_id uuid,
  p_request_id uuid,
  p_resolution text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests%rowtype;
  v_payment public.payments%rowtype;
  v_payout public.company_payout_items%rowtype;
  v_balance_state text;
  v_resolution text:=trim(coalesce(p_resolution,''));
  v_allowed boolean:=false;
begin
  if p_master_id is null or not exists(select 1 from public.profiles where id=p_master_id and active and role::text='master') then
    raise exception 'Only an active Master can resolve payment disputes';
  end if;
  if length(v_resolution)<5 or length(v_resolution)>1000 then raise exception 'Master resolution must contain 5 to 1000 characters'; end if;

  select * into v_request
  from public.service_requests
  where id=p_request_id and request_type='payment_dispute'
  for update;
  if not found then raise exception 'Payment dispute was not found'; end if;

  if v_request.status='resolved' and v_request.master_outcome='customer' then
    return jsonb_build_object('saved',true,'duplicate',true,'status','resolved','outcome','customer','refundId',v_request.master_refund_id);
  end if;
  if v_request.status='resolved' then raise exception 'Payment dispute is already resolved'; end if;

  select * into v_payment from public.payments where id=v_request.payment_id for update;
  if not found then raise exception 'Payment dispute has no canonical payment'; end if;
  if nullif(trim(coalesce(v_payment.stripe_charge_id,'')),'') is null then raise exception 'Payment has no Stripe charge to refund'; end if;
  if v_payment.status::text='refunded' then raise exception 'Payment is already refunded'; end if;
  if v_payment.status::text not in('paid','succeeded') then raise exception 'Payment is not eligible for refund'; end if;

  select * into v_payout
  from public.company_payout_items
  where payment_id=v_payment.id and company_id=v_request.company_id
  limit 1 for update;

  if v_request.status='refund_pending' and v_request.master_outcome='customer' then
    return jsonb_build_object(
      'saved',true,'duplicate',true,'status','refund_pending','outcome','customer',
      'paymentId',v_payment.id,'invoiceId',v_payment.invoice_id,'companyId',v_request.company_id,'customerId',v_request.customer_id,
      'chargeId',v_payment.stripe_charge_id,'amountCents',round(coalesce(v_payment.amount,0)*100)::bigint,
      'payoutExists',v_payout.id is not null,'payoutStatus',v_payout.status,'transferId',v_payout.stripe_transfer_id,'refundId',v_request.master_refund_id
    );
  end if;

  v_allowed:=v_request.status in('escalated','overdue')
    or (v_request.status in('pending','open','investigating') and v_request.response_due_at is not null and v_request.response_due_at<=now());
  if not v_allowed then raise exception 'Master can refund only an escalated or overdue payment dispute'; end if;

  if v_payout.id is not null and v_payout.status not in('refunded','cancelled') then
    update public.company_payout_items
    set status='disputed',hold_reason='Master customer refund pending · dispute '||v_request.id::text,eligible_at=null,updated_at=now()
    where id=v_payout.id;
  end if;

  if v_payout.id is not null then
    select state into v_balance_state from public.company_balance_entries where payout_item_id=v_payout.id;
  end if;

  if nullif(trim(coalesce(v_payout.stripe_transfer_id,'')),'') is not null or v_balance_state='paid_out' then
    update public.organizations
    set stripe_payout_reconciliation_hold=true,
        stripe_payout_reconciliation_note='Master refund dispute '||v_request.id::text||' is waiting for Stripe transfer reversal.',
        stripe_payout_reconciled_at=now()
    where id=v_request.company_id and coalesce(stripe_payout_reconciliation_hold,false)=false;
  end if;

  update public.service_requests
  set status='refund_pending',
      master_outcome='customer',
      master_resolution=v_resolution,
      master_reviewed_by_profile_id=p_master_id,
      master_reviewed_at=now(),
      master_refund_requested_at=now(),
      updated_at=now()
  where id=v_request.id;

  insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(
    p_master_id,v_request.company_id,'payment_dispute.customer_refund_requested','service_request',v_request.id,
    jsonb_build_object('payment_id',v_payment.id,'invoice_id',v_payment.invoice_id,'customer_id',v_request.customer_id,'amount_cents',round(coalesce(v_payment.amount,0)*100)::bigint,'resolution',v_resolution,'payout_id',v_payout.id,'transfer_id',v_payout.stripe_transfer_id)
  );

  return jsonb_build_object(
    'saved',true,'duplicate',false,'status','refund_pending','outcome','customer',
    'paymentId',v_payment.id,'invoiceId',v_payment.invoice_id,'companyId',v_request.company_id,'customerId',v_request.customer_id,
    'chargeId',v_payment.stripe_charge_id,'amountCents',round(coalesce(v_payment.amount,0)*100)::bigint,
    'payoutExists',v_payout.id is not null,'payoutStatus',v_payout.status,'transferId',v_payout.stripe_transfer_id,'refundId',v_request.master_refund_id
  );
end $$;

revoke all on function public.mark_master_payment_dispute_refund_pending(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mark_master_payment_dispute_refund_pending(uuid,uuid,text) to service_role;

create or replace function public.finalize_master_refund_without_payout(
  p_master_id uuid,
  p_request_id uuid,
  p_refund_id text
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests%rowtype;
  v_payment public.payments%rowtype;
begin
  if p_master_id is null or not exists(select 1 from public.profiles where id=p_master_id and active and role::text='master') then
    raise exception 'Only an active Master can finalize a payment refund';
  end if;
  if nullif(trim(coalesce(p_refund_id,'')),'') is null then raise exception 'Stripe refund id is required'; end if;

  select * into v_request from public.service_requests where id=p_request_id and request_type='payment_dispute' for update;
  if not found then raise exception 'Payment dispute was not found'; end if;
  if v_request.status='resolved' and v_request.master_outcome='customer' then return; end if;
  if v_request.status<>'refund_pending' or v_request.master_outcome<>'customer' or v_request.master_reviewed_by_profile_id is distinct from p_master_id then
    raise exception 'Payment dispute is not waiting for this Master refund';
  end if;
  if exists(select 1 from public.company_payout_items where payment_id=v_request.payment_id) then
    raise exception 'Refund has a payout item and must finish through Stripe webhook reconciliation';
  end if;

  select * into v_payment from public.payments where id=v_request.payment_id for update;
  if not found then raise exception 'Payment dispute has no canonical payment'; end if;

  update public.service_requests
  set master_refund_id=p_refund_id,master_refund_requested_at=coalesce(master_refund_requested_at,now()),updated_at=now()
  where id=v_request.id;

  update public.payments set status='refunded' where id=v_payment.id and status::text in('paid','succeeded');
  if v_payment.invoice_id is not null then
    update public.invoices set status='refunded' where id=v_payment.invoice_id and status::text in('paid','processing','waiting_payment','sent','overdue');
  end if;
end $$;

revoke all on function public.finalize_master_refund_without_payout(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_master_refund_without_payout(uuid,uuid,text) to service_role;

create or replace function public.finalize_master_refund_dispute_from_payment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.service_requests%rowtype;
  v_payout_status text;
  v_hold_note text;
begin
  if new.status::text<>'refunded' or old.status::text='refunded' then return new; end if;

  select * into v_request
  from public.service_requests
  where payment_id=new.id and request_type='payment_dispute' and status='refund_pending' and master_outcome='customer'
  order by created_at desc
  limit 1 for update;
  if not found then return new; end if;

  select status into v_payout_status
  from public.company_payout_items
  where payment_id=new.id and company_id=v_request.company_id
  limit 1;
  if found and v_payout_status not in('refunded','cancelled') then return new; end if;

  update public.service_requests
  set status='resolved',master_reviewed_at=coalesce(master_reviewed_at,now()),updated_at=now()
  where id=v_request.id;

  select stripe_payout_reconciliation_note into v_hold_note from public.organizations where id=v_request.company_id;
  if v_hold_note like ('Master refund dispute '||v_request.id::text||'%') then
    update public.organizations
    set stripe_payout_reconciliation_hold=false,stripe_payout_reconciliation_note=null,stripe_payout_reconciled_at=now()
    where id=v_request.company_id;
  end if;

  if v_request.master_reviewed_by_profile_id is not null then
    insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
    values(
      v_request.master_reviewed_by_profile_id,v_request.company_id,'payment_dispute.customer_refund_confirmed','service_request',v_request.id,
      jsonb_build_object('payment_id',new.id,'invoice_id',v_request.invoice_id,'refund_id',v_request.master_refund_id)
    );
  end if;

  return new;
end $$;

revoke all on function public.finalize_master_refund_dispute_from_payment() from public,anon,authenticated;
grant execute on function public.finalize_master_refund_dispute_from_payment() to service_role;

drop trigger if exists payment_refund_finalizes_master_dispute on public.payments;
create trigger payment_refund_finalizes_master_dispute
after update of status on public.payments
for each row execute function public.finalize_master_refund_dispute_from_payment();

commit;
