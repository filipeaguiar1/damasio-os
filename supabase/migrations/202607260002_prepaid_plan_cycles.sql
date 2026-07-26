-- Prepaid monthly and seasonal plan cycles.
-- Customer collection is separated from provider payout release.
begin;

alter table public.jobs
  add column if not exists plan_billing_day integer not null default 1
    check (plan_billing_day between 1 and 28),
  add column if not exists service_start_day integer
    check (service_start_day is null or service_start_day between 1 and 28),
  add column if not exists prepaid_plan_type text
    check (prepaid_plan_type is null or prepaid_plan_type in ('monthly','seasonal'));

alter table public.billing_agreements
  add column if not exists collection_timing text not null default 'after_visit'
    check (collection_timing in ('after_visit','period_prepaid','manual')),
  add column if not exists plan_billing_day integer not null default 1
    check (plan_billing_day between 1 and 28),
  add column if not exists service_start_day integer
    check (service_start_day is null or service_start_day between 1 and 28),
  add column if not exists prepaid_plan_type text
    check (prepaid_plan_type is null or prepaid_plan_type in ('monthly','seasonal'));

create table if not exists public.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  billing_agreement_id uuid not null references public.billing_agreements(id) on delete restrict,
  company_id uuid references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  cycle_type text not null check (cycle_type in ('monthly','seasonal')),
  period_starts_on date not null,
  period_ends_on date not null,
  charge_due_on date not null,
  service_available_on date not null,
  state text not null default 'scheduled' check (state in (
    'scheduled','invoice_pending','payment_processing','paid','payment_failed',
    'active','completed','cancelled','refunded'
  )),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'cad',
  stripe_invoice_id text unique,
  stripe_payment_intent_id text unique,
  idempotency_key text not null unique,
  paid_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_agreement_id, period_starts_on, period_ends_on),
  check (period_ends_on >= period_starts_on),
  check (service_available_on >= charge_due_on)
);

create index if not exists billing_cycles_due_idx
  on public.billing_cycles(state, charge_due_on);
create index if not exists billing_cycles_customer_idx
  on public.billing_cycles(customer_id, period_starts_on desc);
create index if not exists billing_cycles_company_idx
  on public.billing_cycles(company_id, period_starts_on desc);

alter table public.billing_cycles enable row level security;
revoke all on public.billing_cycles from anon, authenticated;
grant select on public.billing_cycles to authenticated;

drop policy if exists billing_cycles_customer_read on public.billing_cycles;
create policy billing_cycles_customer_read on public.billing_cycles
for select to authenticated using (
  exists (
    select 1 from public.customers c
    where c.id = billing_cycles.customer_id
      and c.profile_id = auth.uid()
      and c.archived_at is null
  )
);

commit;
