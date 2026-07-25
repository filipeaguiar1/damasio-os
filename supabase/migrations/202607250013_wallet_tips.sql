begin;

alter table public.customer_tips alter column stripe_payment_intent_id drop not null;
alter table public.customer_tips add column if not exists payment_method text not null default 'card' check (payment_method in ('card','wallet'));
alter table public.customer_tips add column if not exists wallet_transaction_id uuid references public.customer_wallet_transactions(id) on delete set null;
create unique index if not exists customer_tips_wallet_transaction_unique on public.customer_tips(wallet_transaction_id) where wallet_transaction_id is not null;

create or replace function public.pay_customer_tip_from_wallet(
  p_customer_id uuid,
  p_company_id uuid,
  p_amount_cents bigint,
  p_note text default null
)
returns table(balance_cents bigint, tip_id uuid, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.customer_wallets%rowtype;
  v_tx_id uuid;
  v_tip_id uuid;
begin
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 50000 then
    raise exception 'Tip must be between 100 and 50000 cents';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id and archived_at is null) then
    raise exception 'Customer not found';
  end if;

  select * into v_wallet
  from public.customer_wallets
  where customer_id = p_customer_id
  for update;

  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if v_wallet.balance_cents < p_amount_cents then raise exception 'Insufficient wallet balance'; end if;

  update public.customer_wallets
  set balance_cents = balance_cents - p_amount_cents,
      company_id = coalesce(p_company_id, company_id),
      updated_at = now()
  where id = v_wallet.id
  returning * into v_wallet;

  insert into public.customer_wallet_transactions(
    wallet_id, company_id, customer_id, transaction_type, amount_cents,
    balance_after_cents, reference_type, description
  ) values (
    v_wallet.id, p_company_id, p_customer_id, 'tip', -p_amount_cents,
    v_wallet.balance_cents, 'customer_tip', coalesce(nullif(trim(p_note), ''), 'Tip paid with wallet credits')
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
$$;

revoke all on function public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text) to service_role;

commit;
