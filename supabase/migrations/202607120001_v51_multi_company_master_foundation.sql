-- Damasio OS V51.0 — Multi Company / hidden Master foundation
-- Safe additive migration: existing organization_id fields remain operational during the transition.

begin;

-- Add master to the existing role enum without rebuilding current data.
alter type public.app_role add value if not exists 'master';

alter table public.organizations
  add column if not exists active boolean not null default true,
  add column if not exists plan_name text not null default 'standard',
  add column if not exists contact_email text,
  add column if not exists updated_at timestamptz not null default now();

-- company_id becomes the canonical V51 identifier on profiles while organization_id remains
-- as a compatibility field for the current V50 repositories.
alter table public.profiles add column if not exists company_id uuid references public.organizations(id) on delete cascade;
update public.profiles set company_id = organization_id where company_id is null and organization_id is not null;
create index if not exists idx_profiles_company_role on public.profiles(company_id, role);

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

create index if not exists idx_master_access_company on public.master_company_access_requests(company_id, created_at desc);
create index if not exists idx_master_access_master on public.master_company_access_requests(master_profile_id, created_at desc);

create table if not exists public.master_audit_log (
  id uuid primary key default gen_random_uuid(),
  master_profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.organizations(id) on delete set null,
  access_request_id uuid references public.master_company_access_requests(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_master_audit_company on public.master_audit_log(company_id, created_at desc);

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
create index if not exists idx_lead_center_company_status on public.lead_center(assigned_company_id, status);

alter table public.master_company_access_requests enable row level security;
alter table public.master_audit_log enable row level security;
alter table public.lead_center enable row level security;

-- Only authenticated Master profiles can see the private Master control plane.
drop policy if exists master_access_requests_master_only on public.master_company_access_requests;
create policy master_access_requests_master_only on public.master_company_access_requests
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
);

drop policy if exists master_audit_master_only on public.master_audit_log;
create policy master_audit_master_only on public.master_audit_log
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
);

drop policy if exists lead_center_master_only on public.lead_center;
create policy lead_center_master_only on public.lead_center
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master' and p.active)
);

commit;
