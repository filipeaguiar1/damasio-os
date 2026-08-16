create or replace function public.credit_customer_wallet(
  p_company_id uuid,
  p_customer_id uuid,
  p_amount_cents bigint,
  p_stripe_payment_intent_id text,
  p_description text default 'Stripe wallet top-up'
)
returns table(balance_cents bigint, credited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wallet public.customer_wallets%rowtype;
  v_existing public.customer_wallet_transactions%rowtype;
  v_debt_payment bigint;
  v_balance_credit bigint;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_amount_cents is null or p_amount_cents < 100 then
    raise exception 'Wallet top-up must be at least 100 cents';
  end if;
  if nullif(trim(coalesce(p_stripe_payment_intent_id, '')), '') is null then
    raise exception 'Stripe payment intent is required';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.archived_at is null
  ) then
    raise exception 'Customer not found';
  end if;

  select wt.* into v_existing
  from public.customer_wallet_transactions wt
  where wt.stripe_payment_intent_id = p_stripe_payment_intent_id
  limit 1;
  if v_existing.id is not null then
    select cw.* into v_wallet
    from public.customer_wallets cw
    where cw.id = v_existing.wallet_id;
    return query select v_wallet.balance_cents, false;
    return;
  end if;

  insert into public.customer_wallets as cw(company_id,customer_id)
  values(p_company_id,p_customer_id)
  on conflict (customer_id) do update
  set company_id = coalesce(excluded.company_id,cw.company_id),
      updated_at = now();

  select cw.* into v_wallet
  from public.customer_wallets cw
  where cw.customer_id = p_customer_id
  for update;

  v_debt_payment := least(v_wallet.chargeback_debt_cents,p_amount_cents);
  v_balance_credit := p_amount_cents - v_debt_payment;

  update public.customer_wallets cw
  set balance_cents = cw.balance_cents + v_balance_credit,
      chargeback_debt_cents = cw.chargeback_debt_cents - v_debt_payment,
      company_id = coalesce(p_company_id,cw.company_id),
      updated_at = now()
  where cw.id = v_wallet.id
  returning cw.* into v_wallet;

  insert into public.customer_wallet_transactions(
    wallet_id,company_id,customer_id,transaction_type,amount_cents,
    balance_after_cents,stripe_payment_intent_id,reference_type,description
  ) values (
    v_wallet.id,p_company_id,p_customer_id,'topup',p_amount_cents,
    v_wallet.balance_cents,p_stripe_payment_intent_id,
    case when v_debt_payment > 0 then 'chargeback_debt_settlement' else null end,
    case when v_debt_payment > 0 then
      concat(
        coalesce(nullif(trim(coalesce(p_description,'')),''),'Stripe wallet top-up'),
        '; ',to_char(v_debt_payment / 100.0,'FM999999990.00'),' CAD applied to chargeback debt'
      )
    else nullif(trim(coalesce(p_description,'')),'') end
  );

  return query select v_wallet.balance_cents, true;
end;
$function$;

revoke all on function public.credit_customer_wallet(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.credit_customer_wallet(uuid,uuid,bigint,text,text) to service_role;
