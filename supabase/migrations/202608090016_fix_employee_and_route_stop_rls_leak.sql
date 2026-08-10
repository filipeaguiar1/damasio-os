-- Close tenant-membership-only RLS that exposed all Employee rows and all
-- canonical Route Stops to Customer sessions. Preserve Admin/authorized
-- Manager access, Employee self/assigned-route access and Master support.

begin;

drop policy if exists "Company members manage own employees" on public.employees;
drop policy if exists employees_admin_all on public.employees;
drop policy if exists employees_company_operator_select on public.employees;
drop policy if exists employees_company_operator_insert on public.employees;
drop policy if exists employees_company_operator_update on public.employees;

create policy employees_company_operator_select
on public.employees
for select
to authenticated
using (
  profile_id=auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(employees.company_id,employees.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('employees','view'))
      )
  )
  or public.master_has_company_access(coalesce(employees.company_id,employees.organization_id),'read_only')
);

create policy employees_company_operator_insert
on public.employees
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(employees.company_id,employees.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('employees','manage'))
      )
  )
  or public.master_has_company_access(coalesce(employees.company_id,employees.organization_id),'operational_support')
);

create policy employees_company_operator_update
on public.employees
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(employees.company_id,employees.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('employees','manage'))
      )
  )
  or public.master_has_company_access(coalesce(employees.company_id,employees.organization_id),'operational_support')
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(employees.company_id,employees.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('employees','manage'))
      )
  )
  or public.master_has_company_access(coalesce(employees.company_id,employees.organization_id),'operational_support')
);

-- Keep any pre-existing self-read policy; the explicit SELECT above also
-- preserves self-read when policy histories differ.

drop policy if exists route_stops_company_admin_all on public.route_stops;
drop policy if exists route_stops_company_read on public.route_stops;
drop policy if exists route_stops_company_select on public.route_stops;
drop policy if exists route_stops_authorized_select on public.route_stops;
drop policy if exists route_stops_authorized_insert on public.route_stops;
drop policy if exists route_stops_authorized_update on public.route_stops;
drop policy if exists route_stops_authorized_delete on public.route_stops;

create policy route_stops_authorized_select
on public.route_stops
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(route_stops.company_id,route_stops.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','view'))
        or (p.role::text='employee' and public.employee_can_use_route(route_stops.route_id))
      )
  )
  or public.master_has_company_access(coalesce(route_stops.company_id,route_stops.organization_id),'read_only')
);

create policy route_stops_authorized_insert
on public.route_stops
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(route_stops.company_id,route_stops.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','manage'))
      )
  )
  or public.master_has_company_access(coalesce(route_stops.company_id,route_stops.organization_id),'operational_support')
);

create policy route_stops_authorized_update
on public.route_stops
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(route_stops.company_id,route_stops.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','manage'))
      )
  )
  or public.master_has_company_access(coalesce(route_stops.company_id,route_stops.organization_id),'operational_support')
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(route_stops.company_id,route_stops.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','manage'))
      )
  )
  or public.master_has_company_access(coalesce(route_stops.company_id,route_stops.organization_id),'operational_support')
);

create policy route_stops_authorized_delete
on public.route_stops
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id=auth.uid()
      and p.active
      and coalesce(p.company_id,p.organization_id)=coalesce(route_stops.company_id,route_stops.organization_id)
      and (
        p.role::text='admin'
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','manage'))
      )
  )
  or public.master_has_company_access(coalesce(route_stops.company_id,route_stops.organization_id),'operational_support')
);

commit;
