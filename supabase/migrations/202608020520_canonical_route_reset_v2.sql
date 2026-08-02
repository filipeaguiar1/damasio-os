begin;

create or replace function public.reset_company_route_ownership_v2(
  p_cleanup_demo_identities boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_company_id uuid;
  v_route_ids uuid[] := '{}'::uuid[];
  v_route_id uuid;
  v_sync jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_job_count integer := 0;
  v_visit_count integer := 0;
  v_demo_employee_count integer := 0;
  v_demo_profile_count integer := 0;
  v_demo_crew_count integer := 0;
  v_demo_employee_ids uuid[] := '{}'::uuid[];
  v_demo_profile_ids uuid[] := '{}'::uuid[];
  v_demo_crew_ids uuid[] := '{}'::uuid[];
begin
  select *
  into v_profile
  from public.profiles
  where id = auth.uid()
    and active;

  if not found or v_profile.role::text not in ('admin', 'manager', 'master') then
    raise exception 'Only an active company Admin can reset route ownership.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);
  if v_company_id is null then
    raise exception 'Your Admin profile is not linked to a company.';
  end if;

  if exists (
    select 1
    from public.visits v
    where coalesce(v.company_id, v.organization_id) = v_company_id
      and v.status::text = 'in_progress'
  ) then
    raise exception 'Route reset is blocked while a service is in progress.';
  end if;

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_route_ids
  from public.visits v
  where coalesce(v.company_id, v.organization_id) = v_company_id
    and v.route_id is not null
    and v.status::text not in ('in_progress', 'completed');

  update public.jobs
  set
    default_crew_id = null,
    recurrence_anchor_date = null,
    default_route_order = null
  where active
    and coalesce(company_id, organization_id) = v_company_id;
  get diagnostics v_job_count = row_count;

  update public.visits
  set
    route_id = null,
    assigned_employee_id = null,
    crew_id = null,
    route_order = null
  where coalesce(company_id, organization_id) = v_company_id
    and status::text not in ('in_progress', 'completed');
  get diagnostics v_visit_count = row_count;

  foreach v_route_id in array v_route_ids loop
    v_sync := public.sync_canonical_route_stops_v2(
      v_route_id,
      'route_ownership_reset'
    );
    v_versions := v_versions || jsonb_build_object(
      v_route_id::text,
      v_sync -> 'version'
    );
  end loop;

  if p_cleanup_demo_identities then
    select
      coalesce(array_agg(e.id), '{}'::uuid[]),
      coalesce(array_agg(distinct e.crew_id) filter (where e.crew_id is not null), '{}'::uuid[])
    into v_demo_employee_ids, v_demo_crew_ids
    from public.employees e
    where coalesce(e.company_id, e.organization_id) = v_company_id
      and e.active
      and (
        lower(coalesce(e.full_name, '')) like 'demo%'
        or lower(coalesce(e.email, '')) like 'demo%@%'
        or lower(coalesce(e.email, '')) like '%@example.com'
        or lower(coalesce(e.email, '')) like '%@4everseasons.test'
      );

    select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_demo_profile_ids
    from public.profiles p
    where coalesce(p.company_id, p.organization_id) = v_company_id
      and p.active
      and p.role::text = 'employee'
      and (
        lower(coalesce(p.full_name, '')) like 'demo%'
        or lower(coalesce(p.email, '')) like 'demo%@%'
        or lower(coalesce(p.email, '')) like '%@example.com'
        or lower(coalesce(p.email, '')) like '%@4everseasons.test'
      );

    update public.employees
    set active = false
    where id = any(v_demo_employee_ids);
    get diagnostics v_demo_employee_count = row_count;

    update public.profiles
    set active = false
    where id = any(v_demo_profile_ids);
    get diagnostics v_demo_profile_count = row_count;

    update public.crews
    set active = false
    where id = any(v_demo_crew_ids);
    get diagnostics v_demo_crew_count = row_count;
  end if;

  if exists (
    select 1
    from public.jobs j
    where j.active
      and coalesce(j.company_id, j.organization_id) = v_company_id
      and j.default_crew_id is not null
  ) then
    raise exception 'One or more Job assignments remained after reset.';
  end if;

  if exists (
    select 1
    from public.visits v
    where coalesce(v.company_id, v.organization_id) = v_company_id
      and v.status::text not in ('in_progress', 'completed')
      and (
        v.route_id is not null
        or v.assigned_employee_id is not null
        or v.crew_id is not null
        or v.route_order is not null
      )
  ) then
    raise exception 'One or more planned Visit assignments remained after reset.';
  end if;

  if exists (
    select 1
    from public.route_stops s
    join public.visits v on v.id = s.visit_id
    where s.company_id = v_company_id
      and v.route_id is distinct from s.route_id
  ) then
    raise exception 'Route Stops verification failed after reset.';
  end if;

  insert into public.activity_log(
    organization_id,
    company_id,
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    details,
    metadata
  )
  values (
    v_company_id,
    v_company_id,
    v_profile.id,
    'route.ownership_reset',
    'company',
    v_company_id,
    'Admin reset planned route ownership transactionally while preserving active and completed work.',
    jsonb_build_object(
      'unassigned_job_count', v_job_count,
      'cleared_visit_count', v_visit_count,
      'route_versions', v_versions,
      'deactivated_demo_employee_count', v_demo_employee_count,
      'deactivated_demo_profile_count', v_demo_profile_count,
      'deactivated_demo_crew_count', v_demo_crew_count,
      'canonical_source', 'route_stops_v2'
    )
  );

  return jsonb_build_object(
    'companyId', v_company_id,
    'unassignedJobCount', v_job_count,
    'clearedVisitCount', v_visit_count,
    'removedVisitCount', 0,
    'removedRouteCount', 0,
    'deactivatedDemoEmployeeCount', v_demo_employee_count,
    'deactivatedDemoProfileCount', v_demo_profile_count,
    'deactivatedDemoCrewCount', v_demo_crew_count,
    'routeVersions', v_versions,
    'canonicalSource', 'route_stops_v2',
    'customersPreserved', true,
    'propertiesPreserved', true,
    'jobsPreserved', true,
    'completedHistoryPreserved', true
  );
end;
$$;

revoke all on function public.reset_company_route_ownership_v2(boolean)
  from public, anon;
grant execute on function public.reset_company_route_ownership_v2(boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
