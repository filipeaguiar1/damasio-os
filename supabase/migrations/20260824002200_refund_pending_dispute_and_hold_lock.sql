-- Keep refund-pending disputes unique and make payout reconciliation holds impossible to clear too early.
begin;

drop index if exists public.service_requests_one_open_payment_dispute_idx;
create unique index service_requests_one_open_payment_dispute_idx
on public.service_requests(customer_id,payment_id)
where request_type='payment_dispute'
  and status in('pending','open','investigating','company_responded','escalated','overdue','refund_pending');

-- Master API uses a service-role client, so explicit Master identity is passed and
-- revalidated here rather than depending on auth.uid().
drop function if exists public.clear_company_payout_reconciliation_hold(uuid);
create or replace function public.clear_company_payout_reconciliation_hold(
  p_company_id uuid,
  p_master_id uuid
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_master_id is null or not exists(
    select 1 from public.profiles where id=p_master_id and active and role::text='master'
  ) then
    raise exception 'Only an active Master can clear payout reconciliation hold';
  end if;

  if exists(
    select 1
    from public.service_requests sr
    join public.company_payout_items pi
      on pi.payment_id=sr.payment_id and pi.company_id=sr.company_id
    left join public.company_balance_entries be on be.payout_item_id=pi.id
    where sr.company_id=p_company_id
      and sr.request_type='payment_dispute'
      and sr.status='refund_pending'
      and sr.master_outcome='customer'
      and (
        nullif(trim(coalesce(pi.stripe_transfer_id,'')),'') is not null
        or be.state='paid_out'
        or coalesce(be.reserved_cents,0)>0
      )
  ) then
    raise exception 'Cannot clear payout hold while a Master customer refund still requires Stripe payout reconciliation';
  end if;

  update public.organizations
  set stripe_payout_reconciliation_hold=false,
      stripe_payout_reconciliation_note=null,
      stripe_payout_reconciled_at=now()
  where id=p_company_id;
end $$;

revoke all on function public.clear_company_payout_reconciliation_hold(uuid,uuid) from public,anon,authenticated;
grant execute on function public.clear_company_payout_reconciliation_hold(uuid,uuid) to service_role;

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
  v_other_refund uuid;
begin
  if new.status::text<>'refunded' or old.status::text='refunded' then return new; end if;

  select * into v_request
  from public.service_requests
  where payment_id=new.id
    and request_type='payment_dispute'
    and status='refund_pending'
    and master_outcome='customer'
  order by created_at desc
  limit 1
  for update;
  if not found then return new; end if;

  select status into v_payout_status
  from public.company_payout_items
  where payment_id=new.id and company_id=v_request.company_id
  limit 1;
  if found and v_payout_status not in('refunded','cancelled') then return new; end if;

  update public.service_requests
  set status='resolved',
      master_reviewed_at=coalesce(master_reviewed_at,now()),
      updated_at=now()
  where id=v_request.id;

  select sr.id into v_other_refund
  from public.service_requests sr
  join public.company_payout_items pi
    on pi.payment_id=sr.payment_id and pi.company_id=sr.company_id
  left join public.company_balance_entries be on be.payout_item_id=pi.id
  where sr.company_id=v_request.company_id
    and sr.id<>v_request.id
    and sr.request_type='payment_dispute'
    and sr.status='refund_pending'
    and sr.master_outcome='customer'
    and (
      nullif(trim(coalesce(pi.stripe_transfer_id,'')),'') is not null
      or be.state='paid_out'
      or coalesce(be.reserved_cents,0)>0
    )
  order by sr.created_at
  limit 1;

  select stripe_payout_reconciliation_note into v_hold_note
  from public.organizations where id=v_request.company_id;

  if v_hold_note like ('Master refund dispute '||v_request.id::text||'%') then
    if v_other_refund is null then
      update public.organizations
      set stripe_payout_reconciliation_hold=false,
          stripe_payout_reconciliation_note=null,
          stripe_payout_reconciled_at=now()
      where id=v_request.company_id;
    else
      update public.organizations
      set stripe_payout_reconciliation_hold=true,
          stripe_payout_reconciliation_note='Master refund dispute '||v_other_refund::text||' is waiting for Stripe transfer reversal.',
          stripe_payout_reconciled_at=now()
      where id=v_request.company_id;
    end if;
  end if;

  if v_request.master_reviewed_by_profile_id is not null then
    insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
    values(
      v_request.master_reviewed_by_profile_id,
      v_request.company_id,
      'payment_dispute.customer_refund_confirmed',
      'service_request',
      v_request.id,
      jsonb_build_object(
        'payment_id',new.id,
        'invoice_id',v_request.invoice_id,
        'refund_id',v_request.master_refund_id,
        'next_refund_hold_request_id',v_other_refund
      )
    );
  end if;

  return new;
end $$;

revoke all on function public.finalize_master_refund_dispute_from_payment() from public,anon,authenticated;
grant execute on function public.finalize_master_refund_dispute_from_payment() to service_role;

commit;
