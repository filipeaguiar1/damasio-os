begin;

-- Employee administration compatibility.
alter table public.profiles
  add column if not exists manager_permissions jsonb not null default '{}'::jsonb;

-- Customer-owned comment remains separate from Admin operational notes.
alter table public.properties
  add column if not exists customer_comment text;

-- Canonical Stripe wallet deposit invoices.
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

-- Server routes use service_role after validating the signed-in profile and tenant.
grant usage on schema public to service_role;
grant select, insert, update on table public.profiles to service_role;
grant select, insert, update on table public.customers to service_role;
grant select, insert, update on table public.properties to service_role;
grant select, insert, update, delete on table public.photos to service_role;
grant select, insert, update on table public.employees to service_role;
grant select on table public.crews to service_role;
grant select, insert, update, delete on table public.customer_deposit_invoices to service_role;

revoke all on table public.customer_deposit_invoices from anon, authenticated;

-- Remove only the known legacy demo request from the canonical database.
delete from public.lead_center
where lower(coalesce(email, '')) = 'customer@email.com'
  and lower(coalesce(full_name, '')) = 'customer demo'
  and lower(coalesce(address, '')) like '123 king st%';

-- Remove the matching demo property/customer only when they are not linked to a real login.
delete from public.properties p
using public.customers c
where p.customer_id = c.id
  and lower(coalesce(c.email, '')) = 'customer@email.com'
  and lower(coalesce(c.full_name, '')) = 'customer demo'
  and lower(coalesce(p.address_line1, '')) like '123 king st%'
  and c.profile_id is null;

delete from public.customers
where lower(coalesce(email, '')) = 'customer@email.com'
  and lower(coalesce(full_name, '')) = 'customer demo'
  and profile_id is null
  and not exists (
    select 1 from public.properties p where p.customer_id = public.customers.id
  );

commit;
