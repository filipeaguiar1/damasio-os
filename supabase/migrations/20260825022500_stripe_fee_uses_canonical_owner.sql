begin;

create or replace function public.apply_stripe_processing_fee(
  p_invoice_id uuid,
  p_payment_intent_id text,
  p_charge_id text,
  p_fee_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_item public.company_payout_items%rowtype;
  v_owner text;
  v_fee numeric;
  v_company_net numeric;
  v_master_amount bigint;
begin
  if p_invoice_id is null or nullif(trim(coalesce(p_payment_intent_id,'')),'') is null then
    raise exception 'Invoice and PaymentIntent are required';
  end if;
  if p_fee_cents is null or p_fee_cents<0 then raise exception 'Stripe fee cannot be negative'; end if;

  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Invoice not found'; end if;
  if nullif(trim(coalesce(v_invoice.stripe_payment_intent_id,'')),'') is not null
     and v_invoice.stripe_payment_intent_id<>p_payment_intent_id then
    raise exception 'PaymentIntent does not match invoice';
  end if;

  select * into v_payment from public.payments where stripe_payment_intent_id=p_payment_intent_id limit 1;
  if v_payment.id is null then raise exception 'Canonical payment is not available yet'; end if;

  v_owner:=public.canonical_invoice_owner(v_invoice.id);
  v_fee:=round(p_fee_cents::numeric/100,2);

  update public.invoices set
    ownership_type=v_owner,
    stripe_payment_intent_id=p_payment_intent_id,
    stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
    stripe_processing_fee=v_fee,
    stripe_fee_responsibility=case when v_owner='master' then 'master' else 'company' end
  where id=v_invoice.id;

  select * into v_item from public.company_payout_items where payment_id=v_payment.id limit 1;
  if v_item.id is not null then
    if v_owner='company' then
      v_company_net:=round(greatest(0,coalesce(v_item.gross_entitlement,nullif(v_item.transfer_amount,0),0)-v_fee),2);
      update public.company_payout_items set
        ownership_type=v_owner,
        stripe_processing_fee=v_fee,
        transfer_amount=v_company_net,
        updated_at=now()
      where id=v_item.id;
    else
      update public.company_payout_items set
        ownership_type=v_owner,
        stripe_processing_fee=0,
        updated_at=now()
      where id=v_item.id;
      v_company_net:=v_item.transfer_amount;
    end if;
  else
    v_company_net:=0;
  end if;

  update public.invoices
  set stripe_transfer_amount=coalesce(v_company_net,stripe_transfer_amount)
  where id=v_invoice.id;

  update public.master_balance_entries set
    ownership_type=v_owner,
    stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
    stripe_processing_fee_cents=case when v_owner='master' then p_fee_cents else 0 end,
    amount_cents=gross_entitlement_cents-case when v_owner='master' then p_fee_cents else 0 end,
    status_reason=case when v_owner='master'
      then 'Master entitlement net of actual Stripe processing fee.'
      else 'Platform fee retained; company absorbs actual Stripe processing fee.' end,
    updated_at=now()
  where stripe_payment_intent_id=p_payment_intent_id;

  select amount_cents into v_master_amount
  from public.master_balance_entries
  where stripe_payment_intent_id=p_payment_intent_id;

  return jsonb_build_object(
    'invoiceId',v_invoice.id,
    'ownershipType',v_owner,
    'stripeFeeCents',p_fee_cents,
    'companyNetCents',round(coalesce(v_company_net,0)*100)::bigint,
    'masterNetCents',coalesce(v_master_amount,0)
  );
end;
$$;

revoke all on function public.apply_stripe_processing_fee(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_stripe_processing_fee(uuid,text,text,bigint) to service_role;

commit;
