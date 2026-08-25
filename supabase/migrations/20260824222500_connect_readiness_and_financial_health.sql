alter table public.organizations
  add column if not exists stripe_connect_required boolean not null default false;

update public.organizations
set stripe_connect_required = true
where stripe_connected_account_id is not null
   or coalesce(stripe_connect_status,'not_started') <> 'not_started';

comment on column public.organizations.stripe_connect_required is
  'True only when this company is expected to complete Stripe Connect onboarding. Simulation/pre-launch companies remain false until onboarding begins.';
