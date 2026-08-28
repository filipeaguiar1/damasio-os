begin;

-- Keep the exact access rules; only evaluate auth.uid() once per statement.
alter policy profiles_own on public.profiles
  using (id = (select auth.uid()));

alter policy profiles_read_own_profile on public.profiles
  using (id = (select auth.uid()));

alter policy employees_self on public.employees
  using (profile_id = (select auth.uid()));

alter policy employees_company_operator_select on public.employees
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(employees.company_id, employees.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('employees', 'view'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'read_only')
  );

alter policy employees_company_operator_insert on public.employees
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(employees.company_id, employees.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('employees', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  );

alter policy employees_company_operator_update on public.employees
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(employees.company_id, employees.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('employees', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(employees.company_id, employees.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('employees', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  );

alter policy route_stops_authorized_select on public.route_stops
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(route_stops.company_id, route_stops.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('routes', 'view'))
          or (p.role::text = 'employee' and public.employee_can_use_route(route_stops.route_id))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'read_only')
  );

alter policy route_stops_authorized_insert on public.route_stops
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(route_stops.company_id, route_stops.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('routes', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  );

alter policy route_stops_authorized_update on public.route_stops
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(route_stops.company_id, route_stops.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('routes', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(route_stops.company_id, route_stops.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('routes', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  );

alter policy route_stops_authorized_delete on public.route_stops
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and coalesce(p.company_id, p.organization_id) = coalesce(route_stops.company_id, route_stops.organization_id)
        and (
          p.role::text = 'admin'
          or (p.role::text = 'manager' and public.company_module_permission_allowed('routes', 'manage'))
        )
    )
    or public.master_has_company_access(coalesce(company_id, organization_id), 'operational_support')
  );

commit;
