-- Run this small compatibility bootstrap once, before the V51.5 migration.
begin;

alter table public.profiles add column if not exists company_id uuid references public.organizations(id) on delete cascade;
update public.profiles set company_id=organization_id where company_id is null and organization_id is not null;

do $$
declare t text;
begin
  foreach t in array array['customers','crews','employees','properties','jobs','routes','visits','tasks','photos','activity_log'] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.organizations(id) on delete cascade',t);
    execute format('update public.%I set company_id=organization_id where company_id is null and organization_id is not null',t);
  end loop;
end $$;

create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path=public as $$
  select coalesce(company_id,organization_id) from public.profiles where id=auth.uid() and active limit 1
$$;

create table if not exists public.lead_center (
  id uuid primary key default gen_random_uuid(),
  assigned_company_id uuid references public.organizations(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  address text,
  service_requested text,
  notes text,
  status text not null default 'new' check (status in ('new','offered','accepted','declined','converted','archived')),
  accepted_at timestamptz,
  created_by_master_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_audit_log (
  id uuid primary key default gen_random_uuid(),
  master_profile_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.organizations(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lead_center enable row level security;
drop policy if exists lead_center_master_control on public.lead_center;
create policy lead_center_master_control on public.lead_center for all
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role::text='master' and p.active))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role::text='master' and p.active));

commit;
