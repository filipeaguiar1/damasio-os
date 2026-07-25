-- Platform customer wallet. Customers can hold credits before a service company is assigned.
-- 1 credit = 1 CAD dollar. Trusted server code is the only writer.
begin;

create table if not exists public.customer_wallets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.organizations(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_wallets alter column company_id drop not null;
create unique index if not exists customer_wallets_customer_unique on public.customer_wallets(customer_id);

create table if not exists public.customer_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.customer_wallets(id) on delete cascade,
  company_id uuid references public.organizations(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('topup','service','tip','refund','adjustment')),
  amount_cents bigint not null check (amount_cents <> 0),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  stripe_payment_intent_id text,
  reference_type text,
  reference_id uuid,
  description text,
  created_at timestamptz not null default now()
);

alter table public.customer_wallet_transactions alter column company_id drop not null;
create unique index if not exists customer_wallet_transactions_stripe_intent_unique on public.customer_wallet_transactions(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists customer_wallet_transactions_customer_created_idx on public.customer_wallet_transactions(customer_id, created_at desc);

alter table public.customer_wallets enable row level security;
alter table public.customer_wallet_transactions enable row level security;
revoke all on public.customer_wallets from anon, authenticated;
revoke all on public.customer_wallet_transactions from anon, authenticated;
grant select on public.customer_wallets to authenticated;
grant select on public.customer_wallet_transactions to authenticated;

drop policy if exists customer_wallet_read_own on public.customer_wallets;
create policy customer_wallet_read_own on public.customer_wallets for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_wallets.customer_id and c.profile_id = auth.uid() and c.archived_at is null)
);

drop policy if exists customer_wallet_transactions_read_own on public.customer_wallet_transactions;
create policy customer_wallet_transactions_read_own on public.customer_wallet_transactions for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_wallet_transactions.customer_id and c.profile_id = auth.uid() and c.archived_at is null)
);

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
set search_path = public
as $$
declare
  v_wallet public.customer_wallets%rowtype;
  v_existing public.customer_wallet_transactions%rowtype;
begin
  if p_amount_cents is null or p_amount_cents < 100 then raise exception 'Wallet top-up must be at least 100 cents'; end if;
  if nullif(trim(coalesce(p_stripe_payment_intent_id, '')), '') is null then raise exception 'Stripe payment intent is required'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id and archived_at is null) then raise exception 'Customer not found'; end if;

  select * into v_existing from public.customer_wallet_transactions where stripe_payment_intent_id = p_stripe_payment_intent_id;
  if v_existing.id is not null then return query select v_existing.balance_after_cents, false; return; end if;

  insert into public.customer_wallets(company_id, customer_id)
  values (p_company_id, p_customer_id)
  on conflict (customer_id) do update set company_id = coalesce(excluded.company_id, customer_wallets.company_id), updated_at = now();

  select * into v_wallet from public.customer_wallets where customer_id = p_customer_id for update;
  update public.customer_wallets set balance_cents = balance_cents + p_amount_cents, company_id = coalesce(p_company_id, company_id), updated_at = now() where id = v_wallet.id returning * into v_wallet;

  insert into public.customer_wallet_transactions(wallet_id, company_id, customer_id, transaction_type, amount_cents, balance_after_cents, stripe_payment_intent_id, description)
  values (v_wallet.id, p_company_id, p_customer_id, 'topup', p_amount_cents, v_wallet.balance_cents, p_stripe_payment_intent_id, nullif(trim(coalesce(p_description, '')), ''));

  return query select v_wallet.balance_cents, true;
end;
$$;

revoke all on function public.credit_customer_wallet(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.credit_customer_wallet(uuid,uuid,bigint,text,text) to service_role;

commit;
