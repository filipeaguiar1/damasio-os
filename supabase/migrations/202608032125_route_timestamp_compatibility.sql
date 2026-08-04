begin;

alter table public.visits
  add column if not exists updated_at timestamptz not null default now();

alter table public.route_stops
  add column if not exists updated_at timestamptz not null default now();

commit;
