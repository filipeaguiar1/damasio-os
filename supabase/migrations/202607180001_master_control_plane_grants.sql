-- Allow Supabase API roles to reach Master control-plane tables.
-- RLS policies still decide which authenticated users can read each row.

begin;

create extension if not exists pgcrypto;

create table if not exists public.master_company_access_requests (
  id uuid primary key default gen_random_uuid(),
  master_profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.organizations(id) on delete cascade,
  access_level text not null check (access_level in ('read_only','operational_support','full_temporary')),
  delivery_channel text not null check (delivery_channel in ('system','email','both')),
  code_hash text not null,
  code_expires_at timestamptz not null,
  session_expires_at timestamptz,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz,
  request_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_master_access_company
on public.master_company_access_requests(company_id,created_at desc);

create index if not exists idx_master_access_master
on public.master_company_access_requests(master_profile_id,created_at desc);

create table if not exists public.master_audit_log (
  id uuid primary key default gen_random_uuid(),
  master_profile_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.organizations(id) on delete set null,
  access_request_id uuid references public.master_company_access_requests(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_master_audit_company
on public.master_audit_log(company_id,created_at desc);

grant select on table public.organizations to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.employees to authenticated;
grant select on table public.customers to authenticated;
grant select, insert, update on table public.lead_center to authenticated;
grant select on table public.master_company_access_requests to authenticated;
grant select on table public.master_audit_log to authenticated;

grant all privileges on table public.organizations to service_role;
grant all privileges on table public.profiles to service_role;
grant all privileges on table public.employees to service_role;
grant all privileges on table public.customers to service_role;
grant all privileges on table public.lead_center to service_role;
grant all privileges on table public.master_company_access_requests to service_role;
grant all privileges on table public.master_audit_log to service_role;

-- Reassert Master-only policies for the private control-plane tables.
alter table public.lead_center enable row level security;
drop policy if exists lead_center_master_control on public.lead_center;
create policy lead_center_master_control
on public.lead_center
for all
to authenticated
using (public.is_master())
with check (public.is_master());

alter table public.master_company_access_requests enable row level security;
drop policy if exists master_access_requests_master_only on public.master_company_access_requests;
create policy master_access_requests_master_only
on public.master_company_access_requests
for all
to authenticated
using (public.is_master())
with check (public.is_master());

alter table public.master_audit_log enable row level security;
drop policy if exists master_audit_master_only on public.master_audit_log;
create policy master_audit_master_only
on public.master_audit_log
for all
to authenticated
using (public.is_master())
with check (public.is_master());

commit;
