alter table public.customer_wallets
  add column if not exists chargeback_debt_cents bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_wallets'::regclass
      and conname = 'customer_wallets_chargeback_debt_cents_check'
  ) then
    alter table public.customer_wallets
      add constraint customer_wallets_chargeback_debt_cents_check
      check (chargeback_debt_cents >= 0);
  end if;
end $$;

alter table public.customer_wallet_transactions
  add column if not exists stripe_event_id text,
  add column if not exists reversal_of_transaction_id uuid references public.customer_wallet_transactions(id) on delete set null;

create unique index if not exists customer_wallet_transactions_stripe_event_unique
  on public.customer_wallet_transactions(stripe_event_id)
  where stripe_event_id is not null;

alter table public.customer_tips
  add column if not exists refunded_amount_cents bigint not null default 0,
  add column if not exists last_stripe_event_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_tips'::regclass
      and conname = 'customer_tips_refunded_amount_cents_check'
  ) then
    alter table public.customer_tips
      add constraint customer_tips_refunded_amount_cents_check
      check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents);
  end if;
end $$;

alter table public.company_payout_items
  add column if not exists reversed_transfer_amount numeric(12,2) not null default 0,
  add column if not exists stripe_transfer_reversal_ids text[] not null default '{}'::text[],
  add column if not exists last_reversal_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_payout_items'::regclass
      and conname = 'company_payout_items_reversed_amount_check'
  ) then
    alter table public.company_payout_items
      add constraint company_payout_items_reversed_amount_check
      check (reversed_transfer_amount >= 0 and reversed_transfer_amount <= transfer_amount);
  end if;
end $$;

create or replace function public.reverse_customer_wallet_topup(
  p_stripe_payment_intent_id text,
  p_stripe_event_id text,
  p_amount_cents bigint,
  p_reason text default 'Stripe wallet payment reversed'
)
returns table(balance_cents bigint, chargeback_debt_cents bigint, reversed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_original public.customer_wallet_transactions%rowtype;
  v_wallet public.customer_wallets%rowtype;
  v_existing public.customer_wallet_transactions%rowtype;
  v_available bigint;
  v_balance_reduction bigint;
  v_debt_add bigint;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if nullif(trim(coalesce(p_stripe_payment_intent_id, '')), '') is null
     or nullif(trim(coalesce(p_stripe_event_id, '')), '') is null
     or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Valid Stripe reversal identifiers and amount are required';
  end if;

  select wt.* into v_existing
  from public.customer_wallet_transactions wt
  where wt.stripe_event_id = p_stripe_event_id
  limit 1;
  if v_existing.id is not null then
    select cw.* into v_wallet from public.customer_wallets cw where cw.id = v_existing.wallet_id;
    return query select v_wallet.balance_cents, v_wallet.chargeback_debt_cents, false;
    return;
  end if;

  select wt.* into v_original
  from public.customer_wallet_transactions wt
  where wt.stripe_payment_intent_id = p_stripe_payment_intent_id
    and wt.transaction_type = 'topup'
  limit 1;
  if v_original.id is null then
    raise exception 'Original wallet top-up was not found';
  end if;

  select cw.* into v_wallet
  from public.customer_wallets cw
  where cw.id = v_original.wallet_id
  for update;
  if v_wallet.id is null then
    raise exception 'Wallet not found';
  end if;

  v_available := greatest(v_wallet.balance_cents, 0);
  v_balance_reduction := least(v_available, p_amount_cents);
  v_debt_add := p_amount_cents - v_balance_reduction;

  update public.customer_wallets cw
  set balance_cents = cw.balance_cents - v_balance_reduction,
      chargeback_debt_cents = cw.chargeback_debt_cents + v_debt_add,
      updated_at = now()
  where cw.id = v_wallet.id
  returning cw.* into v_wallet;

  insert into public.customer_wallet_transactions(
    wallet_id, company_id, customer_id, transaction_type, amount_cents,
    balance_after_cents, reference_type, reference_id, description,
    stripe_event_id, reversal_of_transaction_id
  ) values (
    v_wallet.id, v_original.company_id, v_original.customer_id, 'refund', -p_amount_cents,
    v_wallet.balance_cents, 'stripe_reversal', v_original.id,
    nullif(trim(coalesce(p_reason, '')), ''), p_stripe_event_id, v_original.id
  );

  update public.customer_deposit_invoices
  set status = 'refunded'
  where stripe_payment_intent_id = p_stripe_payment_intent_id;

  return query select v_wallet.balance_cents, v_wallet.chargeback_debt_cents, true;
end;
$function$;

revoke all on function public.reverse_customer_wallet_topup(text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reverse_customer_wallet_topup(text,text,bigint,text) to service_role;

create or replace function public.pay_customer_tip_from_wallet(
  p_customer_id uuid,
  p_company_id uuid,
  p_amount_cents bigint,
  p_note text default null
)
returns table(balance_cents bigint, tip_id uuid, transaction_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wallet public.customer_wallets%rowtype;
  v_tx_id uuid;
  v_tip_id uuid;
begin
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 50000 then
    raise exception 'Tip must be between 100 and 50000 cents';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.archived_at is null) then
    raise exception 'Customer not found';
  end if;

  select cw.* into v_wallet
  from public.customer_wallets cw
  where cw.customer_id = p_customer_id
  for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if v_wallet.chargeback_debt_cents > 0 then raise exception 'Wallet has unresolved chargeback debt'; end if;
  if v_wallet.balance_cents < p_amount_cents then raise exception 'Insufficient wallet balance'; end if;

  update public.customer_wallets cw
  set balance_cents = cw.balance_cents - p_amount_cents,
      company_id = coalesce(p_company_id, cw.company_id),
      updated_at = now()
  where cw.id = v_wallet.id
  returning cw.* into v_wallet;

  insert into public.customer_wallet_transactions(
    wallet_id, company_id, customer_id, transaction_type, amount_cents,
    balance_after_cents, reference_type, description
  ) values (
    v_wallet.id, p_company_id, p_customer_id, 'tip', -p_amount_cents,
    v_wallet.balance_cents, 'customer_tip',
    coalesce(nullif(trim(p_note), ''), 'Tip paid with wallet credits')
  ) returning id into v_tx_id;

  insert into public.customer_tips(
    customer_id, company_id, amount_cents, payment_method,
    wallet_transaction_id, status, note
  ) values (
    p_customer_id, p_company_id, p_amount_cents, 'wallet',
    v_tx_id, 'paid', nullif(trim(coalesce(p_note, '')), '')
  ) returning id into v_tip_id;

  update public.customer_wallet_transactions set reference_id = v_tip_id where id = v_tx_id;
  return query select v_wallet.balance_cents, v_tip_id, v_tx_id;
end;
$function$;

revoke all on function public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text) from public, anon;
grant execute on function public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text) to service_role;
