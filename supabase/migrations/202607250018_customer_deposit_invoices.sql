begin;

create table if not exists public.customer_deposit_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid references public.organizations(id) on delete set null,
  wallet_transaction_id uuid not null references public.customer_wallet_transactions(id) on delete restrict,
  invoice_number text not null unique,
  status text not null default 'paid' check (status in ('paid','refunded','partially_refunded')),
  amount_cents bigint not null check (amount_cents > 0),
  stripe_payment_intent_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists customer_deposit_invoices_customer_created_idx
  on public.customer_deposit_invoices(customer_id, created_at desc);

alter table public.customer_deposit_invoices enable row level security;
revoke all on public.customer_deposit_invoices from anon, authenticated;
grant select, insert, update, delete on public.customer_deposit_invoices to service_role;

commit;
