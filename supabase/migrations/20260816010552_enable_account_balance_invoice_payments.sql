create unique index if not exists customer_wallet_service_invoice_unique
  on public.customer_wallet_transactions(reference_id)
  where transaction_type='service'
    and reference_type='invoice'
    and reference_id is not null;

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
  if new.status::text<>'paid' or new.invoice_id is null then return new; end if;
  if new.method::text='credit_card'
    and nullif(trim(coalesce(new.stripe_payment_intent_id,'')),'') is null
  then return new; end if;
  if new.method::text not in('credit_card','account_balance') then return new; end if;

  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null or v_invoice.billing_event_id is null then return new; end if;

  select * into v_event
  from public.visit_billing_events
  where id=v_invoice.billing_event_id
  for update;
  if v_event.id is null then raise exception 'Visit billing event not found for paid invoice'; end if;

  select * into v_agreement
  from public.billing_agreements
  where id=v_event.billing_agreement_id;
  if v_agreement.id is null then raise exception 'Billing agreement not found for paid Visit'; end if;

  if abs(new.amount-v_invoice.total)>0.009 then raise exception 'Paid amount does not match Visit invoice'; end if;
  if coalesce(v_agreement.provider_payout_cents,-1)<0
    or v_agreement.provider_payout_cents>v_agreement.customer_amount_cents
  then raise exception 'Billing agreement provider payout is invalid'; end if;

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

create or replace function public.pay_customer_invoice_from_wallet(
  p_customer_id uuid,
  p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer public.customers%rowtype;
  v_invoice public.invoices%rowtype;
  v_wallet public.customer_wallets%rowtype;
  v_amount_cents bigint;
  v_tx_id uuid;
  v_payment_id uuid;
  v_existing_tx public.customer_wallet_transactions%rowtype;
  v_existing_payment public.payments%rowtype;
  v_company uuid;
begin
  select * into v_customer
  from public.customers
  where id=p_customer_id and archived_at is null;
  if v_customer.id is null then raise exception 'Customer not found'; end if;

  v_company:=coalesce(v_customer.company_id,v_customer.organization_id,v_customer.service_company_id);

  select * into v_invoice
  from public.invoices
  where id=p_invoice_id and customer_id=p_customer_id
  for update;
  if v_invoice.id is null then raise exception 'Invoice not found for this Customer'; end if;
  if v_invoice.billing_event_id is null or v_invoice.visit_id is null then
    raise exception 'Account balance can only pay validated after-visit invoices';
  end if;
  if v_invoice.organization_id is distinct from v_company then
    raise exception 'Invoice company does not match Customer ownership';
  end if;

  select * into v_existing_tx
  from public.customer_wallet_transactions
  where transaction_type='service'
    and reference_type='invoice'
    and reference_id=v_invoice.id
  limit 1;

  if v_existing_tx.id is not null then
    select * into v_existing_payment
    from public.payments
    where reference='wallet:'||v_existing_tx.id::text
    limit 1;
    return jsonb_build_object(
      'paid',true,
      'duplicate',true,
      'invoice_id',v_invoice.id,
      'payment_id',v_existing_payment.id,
      'transaction_id',v_existing_tx.id,
      'balance_cents',v_existing_tx.balance_after_cents
    );
  end if;

  if v_invoice.status='paid' then raise exception 'Invoice is already paid by another method'; end if;
  if v_invoice.status not in('waiting_payment','overdue','sent') then
    raise exception 'Invoice is not payable from account balance';
  end if;

  v_amount_cents:=round(v_invoice.total*100)::bigint;
  if v_amount_cents<1 then raise exception 'Invoice amount is invalid'; end if;

  select * into v_wallet
  from public.customer_wallets
  where customer_id=p_customer_id
  for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if coalesce(v_wallet.chargeback_debt_cents,0)>0 then
    raise exception 'Account balance is locked by an unresolved chargeback debt';
  end if;
  if v_wallet.balance_cents<v_amount_cents then raise exception 'Insufficient account balance'; end if;

  update public.customer_wallets
  set balance_cents=balance_cents-v_amount_cents,
      updated_at=clock_timestamp()
  where id=v_wallet.id
  returning * into v_wallet;

  insert into public.customer_wallet_transactions(
    wallet_id,company_id,customer_id,transaction_type,amount_cents,
    balance_after_cents,reference_type,reference_id,description
  ) values(
    v_wallet.id,v_company,p_customer_id,'service',-v_amount_cents,
    v_wallet.balance_cents,'invoice',v_invoice.id,
    'Service invoice paid from account balance'
  )
  returning id into v_tx_id;

  insert into public.payments(
    organization_id,company_id,invoice_id,customer_id,method,status,
    amount,reference,paid_at,notes
  ) values(
    v_company,v_company,v_invoice.id,p_customer_id,'account_balance','paid',
    v_invoice.total,'wallet:'||v_tx_id::text,clock_timestamp(),
    'Account balance payment confirmed atomically from wallet ledger.'
  )
  returning id into v_payment_id;

  update public.invoices
  set status='paid'
  where id=v_invoice.id;

  return jsonb_build_object(
    'paid',true,
    'duplicate',false,
    'invoice_id',v_invoice.id,
    'payment_id',v_payment_id,
    'transaction_id',v_tx_id,
    'balance_cents',v_wallet.balance_cents
  );
end;
$function$;

revoke all on function public.pay_customer_invoice_from_wallet(uuid,uuid)
  from public,anon,authenticated;

grant execute on function public.pay_customer_invoice_from_wallet(uuid,uuid)
  to service_role;
