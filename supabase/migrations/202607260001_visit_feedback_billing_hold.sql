-- Canonical service frequency, billing agreement snapshots, and visit release holds.
-- No Stripe charge or provider transfer is created by this migration.
begin;

alter table public.jobs
  add column if not exists service_frequency text not null default 'one_time'
    check (service_frequency in ('one_time','weekly','biweekly','monthly','custom')),
  add column if not exists custom_frequency_interval integer
    check (custom_frequency_interval is null or custom_frequency_interval > 0),
  add column if not exists custom_frequency_unit text
    check (custom_frequency_unit is null or custom_frequency_unit in ('day','week','month')),
  add column if not exists billing_model text not null default 'manual'
    check (billing_model in ('per_visit_fixed_payout','per_visit_percentage_fee','weekly_subscription','biweekly_subscription','monthly_fixed_subscription','manual')),
  add column if not exists contract_starts_on date,
  add column if not exists contract_ends_on date,
  add column if not exists feedback_window_hours integer not null default 48
    check (feedback_window_hours between 1 and 168);

create table if not exists public.billing_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  job_id uuid not null references public.jobs(id) on delete restrict,
  customer_origin text not null check (customer_origin in ('platform','company')),
  billing_model text not null check (billing_model in ('per_visit_fixed_payout','per_visit_percentage_fee','weekly_subscription','biweekly_subscription','monthly_fixed_subscription','manual')),
  customer_amount_cents bigint check (customer_amount_cents is null or customer_amount_cents >= 0),
  provider_payout_cents bigint check (provider_payout_cents is null or provider_payout_cents >= 0),
  platform_fee_basis_points integer check (platform_fee_basis_points is null or platform_fee_basis_points between 0 and 10000),
  currency text not null default 'cad',
  feedback_window_hours integer not null default 48 check (feedback_window_hours between 1 and 168),
  contract_starts_on date,
  contract_ends_on date,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  accepted_offer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, version),
  check (
    billing_model <> 'per_visit_fixed_payout'
    or provider_payout_cents is not null
  ),
  check (
    billing_model <> 'per_visit_percentage_fee'
    or platform_fee_basis_points is not null
  )
);

create unique index if not exists billing_agreements_one_active_job_idx
  on public.billing_agreements(job_id)
  where active;

create table if not exists public.visit_billing_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  visit_id uuid not null references public.visits(id) on delete restrict,
  billing_agreement_id uuid not null references public.billing_agreements(id) on delete restrict,
  state text not null default 'awaiting_feedback' check (state in (
    'awaiting_feedback','task_hold','release_pending','charge_processing','charged',
    'charge_failed','transfer_pending','transferred','refund_pending','refunded','cancelled'
  )),
  visit_completed_at timestamptz not null,
  feedback_deadline_at timestamptz not null,
  active_task_id uuid references public.tasks(id) on delete set null,
  task_hold_started_at timestamptz,
  task_resolved_at timestamptz,
  reopened_feedback_deadline_at timestamptz,
  eligible_to_charge_at timestamptz,
  charged_at timestamptz,
  transferred_at timestamptz,
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  stripe_transfer_id text unique,
  idempotency_key text not null unique,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(visit_id)
);

create index if not exists visit_billing_events_release_idx
  on public.visit_billing_events(state, feedback_deadline_at);
create index if not exists visit_billing_events_customer_idx
  on public.visit_billing_events(customer_id, created_at desc);
create index if not exists visit_billing_events_company_idx
  on public.visit_billing_events(company_id, created_at desc);

alter table public.billing_agreements enable row level security;
alter table public.visit_billing_events enable row level security;
revoke all on public.billing_agreements from anon, authenticated;
revoke all on public.visit_billing_events from anon, authenticated;
grant select on public.billing_agreements to authenticated;
grant select on public.visit_billing_events to authenticated;

drop policy if exists billing_agreements_customer_read on public.billing_agreements;
create policy billing_agreements_customer_read on public.billing_agreements
for select to authenticated using (
  exists (
    select 1 from public.customers c
    where c.id = billing_agreements.customer_id
      and c.profile_id = auth.uid()
      and c.archived_at is null
  )
);

drop policy if exists visit_billing_events_customer_read on public.visit_billing_events;
create policy visit_billing_events_customer_read on public.visit_billing_events
for select to authenticated using (
  exists (
    select 1 from public.customers c
    where c.id = visit_billing_events.customer_id
      and c.profile_id = auth.uid()
      and c.archived_at is null
  )
);

commit;
