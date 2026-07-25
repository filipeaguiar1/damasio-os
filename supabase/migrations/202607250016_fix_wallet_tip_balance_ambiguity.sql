begin;

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
  if p_amount_cents is null