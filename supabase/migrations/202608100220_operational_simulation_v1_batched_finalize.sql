begin;

-- Finalize a V1 simulator run only after its Visits have been removed through
-- cleanup_operational_simulation_visits in small, timeout-safe batches.
create or replace function public.finalize_operational_simulation_v1_run(
  p_company_id uuid,
  p_run_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_run_id text := lower(trim(coalesce(p_run_id, '')));
  v_pattern text;
  v_customer_ids uuid[] := '{}'::uuid[];
  v_profile_ids uuid[] := '{}'::uuid[];
  v_employee_ids uuid[] := '{}'::uuid[];
  v_crew_ids uuid[] := '{}'::uuid[];
  v_route_ids uuid[] := '{}'::uuid[];
begin
  if p_company_id is null then
    raise exception 'V1 simulation finalizer requires a company.';
  end if;
  if v_run_id = '' or char_length(v_run_id) > 32 or v_run_id !~ '^[a-z0-9]+$' then
    raise exception 'V1 simulation finalizer received an invalid run id.';
  end if;

  v_pattern := 'ops-sim-' || left(p_company_id::text, 8) || '-' || v_run_id || '-%@4everseasons.test';

  select coalesce(array_agg(c.id), '{}'::uuid[])
  into v_customer_ids
  from public.customers c
  where coalesce(c.company_id, c.organization_id) = p_company_id
    and lower(coalesce(c.email, '')) like lower(v_pattern);

  if cardinality(v_customer_ids) = 0 then
    return public.purge_operational_simulation_v1_run(p_company_id, v_run_id);
  end if;

  if exists (
    select 1
    from public.visits v
    where v.customer_id = any(v_customer_ids)
      and coalesce(v.company_id, v.organization_id) = p_company_id
  ) then
    raise exception 'V1 simulation finalizer refused a run whose Visits were not fully cleaned.';
  end if;

  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
  into v_profile_ids
  from (
    select p.id
    from public.profiles p
    where coalesce(p.company_id, p.organization_id) = p_company_id
      and lower(coalesce(p.email, '')) like lower(v_pattern)
    union
    select c.profile_id
    from public.customers c
    where c.id = any(v_customer_ids)
      and c.profile_id is not null
  ) x;

  select coalesce(array_agg(e.id), '{}'::uuid[])
  into v_employee_ids
  from public.employees e
  where e.profile_id = any(v_profile_ids)
    and coalesce(e.company_id, e.organization_id) = p_company_id;

  select coalesce(array_agg(distinct e.crew_id), '{}'::uuid[])
  into v_crew_ids
  from public.employees e
  where e.id = any(v_employee_ids)
    and e.crew_id is not null;

  select coalesce(array_agg(r.id), '{}'::uuid[])
  into v_route_ids
  from public.routes r
  where r.crew_id = any(v_crew_ids)
    and coalesce(r.company_id, r.organization_id) = p_company_id;

  if cardinality(v_route_ids) > 0 and exists (
    select 1 from public.visits v where v.route_id = any(v_route_ids)
  ) then
    raise exception 'V1 simulation finalizer refused a Route that still contains Visits.';
  end if;

  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'operational_simulator_cleanup', true);

  delete from public.employee_smart_route_state where route_id = any(v_route_ids);
  delete from public.route_stops where route_id = any(v_route_ids);
  delete from public.route_order_state where route_id = any(v_route_ids);
  if to_regclass('public.route_map_cache') is not null then
    execute 'delete from public.route_map_cache where route_id = any($1)' using v_route_ids;
  end if;
  delete from public.route_order_audit where route_id = any(v_route_ids);

  delete from public.routes r
  where r.id = any(v_route_ids)
    and coalesce(r.company_id, r.organization_id) = p_company_id;

  return public.purge_operational_simulation_v1_run(p_company_id, v_run_id);
end;
$function$;

revoke all on function public.finalize_operational_simulation_v1_run(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_operational_simulation_v1_run(uuid, text) to service_role;

commit;
