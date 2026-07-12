-- V51.2 manager permissions and property coordinates
alter table if exists public.profiles add column if not exists manager_permissions jsonb not null default '{}'::jsonb;
alter table if exists public.profiles drop constraint if exists profiles_role_check;
alter table if exists public.profiles add constraint profiles_role_check check (role in ('master','admin','manager','employee','customer'));
alter table if exists public.properties add column if not exists latitude double precision;
alter table if exists public.properties add column if not exists longitude double precision;
create index if not exists properties_company_coordinates_idx on public.properties(company_id, latitude, longitude);
