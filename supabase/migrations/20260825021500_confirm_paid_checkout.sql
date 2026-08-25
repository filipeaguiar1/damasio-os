begin;

create or replace function public.confirm_stripe_paid_invoice(
  p_invoice_id uuid,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_group text,
  p_amount_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_expected_cents bigint;
begin
  if p_invoice_id is null or nullif(trim(coalesce(p_payment_intent_id,'')),'') is null then
    raise exception 'Invoice and PaymentIntent are required';
  end if;
  if p_amount_cents is null or p_amount_cents<1 then raise exception 'Paid amount is invalid'; end if;

  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Invoice not found'; end if;
  v_expected_cents:=round(coalesce(v_invoice.total,0)*100)::bigint;
  if v_expected_cents<>p_amount_cents then
    raise exception 'Stripe paid amount % does not match invoice amount %',p_amount_cents,v_expected_cents;
  end if;
  if nullif(trim(coalesce(v_invoice.stripe_payment_intent_id,'')),'') is not null
     and v_invoice.stripe_payment_intent_id<>p_payment_intent_id then
    raise exception 'Invoice already references another PaymentIntent';
  end if;

  update public.invoices set
    status='paid',
    stripe_payment_intent_id=p_payment_intent_id,
    stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
    stripe_transfer_group=coalesce(nullif(trim(coalesce(p_transfer_group,'')),''),stripe_transfer_group)
  where id=v_invoice.id;

  select id into v_payment_id from public.payments
  where stripe_payment_intent_id=p_payment_intent_id limit 1;

  if v_payment_id is null then
    insert into public.payments(
      organization_id,company_id,invoice_id,customer_id,method,status,amount,reference,
      stripe_payment_intent_id,stripe_charge_id,stripe_transfer_group,paid_at,notes
    ) values(
      v_invoice.organization_id,v_invoice.organization_id,v_invoice.id,v_invoice.customer_id,
      'credit_card','paid',v_invoice.total,p_payment_intent_id,
      p_payment_intent_id,nullif(trim(coalesce(p_charge_id,'')),''),
      nullif(trim(coalesce(p_transfer_group,'')),''),clock_timestamp(),
      'Stripe Checkout payment confirmed from paid Checkout Session.'
    ) returning id into v_payment_id;
  else
    update public.payments set
      status='paid',amount=v_invoice.total,
      stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
      stripe_transfer_group=coalesce(nullif(trim(coalesce(p_transfer_group,'')),''),stripe_transfer_group),
      paid_at=coalesce(paid_at,clock_timestamp())
    where id=v_payment_id;
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.confirm_stripe_paid_invoice(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.confirm_stripe_paid_invoice(uuid,text,text,text,bigint) to service_role;

commit;
