create table if not exists public.platform_pricing_settings (
  id text primary key default 'global' check (id = 'global'),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.platform_pricing_settings enable row level security;
revoke all on table public.platform_pricing_settings from anon, authenticated;
grant all on table public.platform_pricing_settings to service_role;

insert into public.platform_pricing_settings (id, config)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;
