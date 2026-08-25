create table if not exists public.stripe_webhook_signing_secrets (
  id uuid primary key default gen_random_uuid(),
  endpoint_id text not null unique,
  scope text not null check (scope in ('platform','connect')),
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

alter table public.stripe_webhook_signing_secrets enable row level security;
revoke all on table public.stripe_webhook_signing_secrets from anon, authenticated;
grant select, insert, update, delete on table public.stripe_webhook_signing_secrets to service_role;

create index if not exists stripe_webhook_signing_secrets_active_idx
  on public.stripe_webhook_signing_secrets(active, scope)
  where active = true;

comment on table public.stripe_webhook_signing_secrets is
  'Service-role-only Stripe webhook signing secrets used for zero-downtime endpoint rotation. Secret values must never be committed to source control.';
