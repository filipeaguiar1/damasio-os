begin;

-- Route boards and simulator cleanup repeatedly resolve active Employees by
-- tenant and profile. These indexes keep those reads bounded as the SaaS grows.
-- They are additive only and do not change tenant/RLS semantics.

create index if not exists profiles_company_role_active_name_idx
  on public.profiles(company_id, role, active, full_name);

create index if not exists profiles_organization_role_active_name_idx
  on public.profiles(organization_id, role, active, full_name);

create index if not exists employees_profile_id_idx
  on public.employees(profile_id);

create index if not exists employees_company_active_created_idx
  on public.employees(company_id, active, created_at desc);

create index if not exists employees_organization_active_created_idx
  on public.employees(organization_id, active, created_at desc);

commit;
