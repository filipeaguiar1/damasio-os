begin;

-- route_map_cache is optional across environments. Keep the exact simulator
-- purge compatible without creating schema solely for cleanup.
create or replace function public._purge_operational_simulation_public_graph(
  p_company_id uuid,
  p_email_pattern text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_customer_ids uuid[] := '{}'::uuid[];
  v_property_ids uuid[] := '{}'::uuid[];
  v_job_ids uuid[] := '{}'::uuid[];
  v_visit_ids uuid[] := '{}'::uuid[];
  v_route_ids uuid[] := '{}'::uuid[];
  v_profile_ids uuid[] := '{}'::uuid[];
  v_employee_ids uuid[] := '{}'::uuid[];
  v_crew_ids uuid[] := '{}'::uuid[];
  v_customer_count integer := 0;
  v_visit_count integer := 0;
begin
  if p_company_id is null or coalesce(trim(p_email_pattern), '') = '' then
    raise exception 'Operational simulation purge requires company and marker.';
  end if;

  select coalesce(array_agg(c.id), '{}'::uuid[])
  into v_customer_ids
  from public.customers c
  where coalesce(c.company_id, c.organization_id) = p_company_id
    and lower(coalesce(c.email, '')) like lower(p_email_pattern);

  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
  into v_profile_ids
  from (
    select p.id
    from public.profiles p
    where coalesce(p.company_id, p.organization_id) = p_company_id
      and lower(coalesce(p.email, '')) like lower(p_email_pattern)
    union
    select c.profile_id
    from public.customers c
    where c.id = any(v_customer_ids)
      and c.profile_id is not null
  ) x;

  if cardinality(v_customer_ids) = 0 and cardinality(v_profile_ids) = 0 then
    return jsonb_build_object('purged', true, 'customerCount', 0, 'visitCount', 0, 'profileIds', '[]'::jsonb);
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
  into v_property_ids
  from public.properties p
  where p.customer_id = any(v_customer_ids)
    and coalesce(p.company_id, p.organization_id) = p_company_id;

  select coalesce(array_agg(j.id), '{}'::uuid[])
  into v_job_ids
  from public.jobs j
  where j.customer_id = any(v_customer_ids)
    and coalesce(j.company_id, j.organization_id) = p_company_id;

  select coalesce(array_agg(v.id), '{}'::uuid[])
  into v_visit_ids
  from public.visits v
  where v.customer_id = any(v_customer_ids)
    and coalesce(v.company_id, v.organization_id) = p_company_id;

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_route_ids
  from public.visits v
  where v.id = any(v_visit_ids)
    and v.route_id is not null;

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

  if cardinality(v_route_ids) > 0 and exists (
    select 1
    from public.visits v
    where v.route_id = any(v_route_ids)
      and (v.customer_id is null or not (v.customer_id = any(v_customer_ids)))
  ) then
    raise exception 'Operational simulation purge refused a Route shared with non-simulation Visits.';
  end if;

  if cardinality(v_employee_ids) > 0 and exists (
    select 1
    from public.visit_assignment_audit a
    where a.to_employee_id = any(v_employee_ids)
      and not (a.visit_id = any(v_visit_ids))
  ) then
    raise exception 'Operational simulation purge refused an Employee referenced by a non-simulation Visit.';
  end if;

  if cardinality(v_crew_ids) > 0 and exists (
    select 1
    from public.visit_assignment_audit a
    where a.to_crew_id = any(v_crew_ids)
      and not (a.visit_id = any(v_visit_ids))
  ) then
    raise exception 'Operational simulation purge refused a Crew referenced by a non-simulation Visit.';
  end if;

  if cardinality(v_profile_ids) > 0 and exists (
    select 1
    from public.visit_reopen_events r
    where r.reopened_by_profile_id = any(v_profile_ids)
      and not (r.visit_id = any(v_visit_ids))
  ) then
    raise exception 'Operational simulation purge refused a profile referenced by a non-simulation reopen event.';
  end if;

  perform set_config('statement_timeout', '120s', true);
  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'operational_simulator_cleanup', true);

  delete from public.visit_assignment_audit
  where visit_id = any(v_visit_ids)
     or job_id = any(v_job_ids)
     or to_employee_id = any(v_employee_ids)
     or to_crew_id = any(v_crew_ids);

  delete from public.visit_billing_events
  where visit_id = any(v_visit_ids)
     or customer_id = any(v_customer_ids)
     or property_id = any(v_property_ids)
     or job_id = any(v_job_ids);

  delete from public.visit_reopen_events
  where visit_id = any(v_visit_ids)
     or customer_id = any(v_customer_ids)
     or property_id = any(v_property_ids)
     or job_id = any(v_job_ids);

  delete from public.visit_route_removal_audit where visit_id = any(v_visit_ids);
  delete from public.visit_transition_audit where visit_id = any(v_visit_ids);

  delete from public.billing_agreements
  where customer_id = any(v_customer_ids)
     or property_id = any(v_property_ids)
     or job_id = any(v_job_ids);

  delete from public.billing_cycles
  where customer_id = any(v_customer_ids)
     or property_id = any(v_property_ids)
     or job_id = any(v_job_ids);

  delete from public.feedback where customer_id = any(v_customer_ids) or visit_id = any(v_visit_ids);
  delete from public.tasks where customer_id = any(v_customer_ids);
  delete from public.service_requests where customer_id = any(v_customer_ids);
  delete from public.payments where customer_id = any(v_customer_ids);
  delete from public.invoices where customer_id = any(v_customer_ids);
  delete from public.photos where property_id = any(v_property_ids) or visit_id = any(v_visit_ids);

  delete from public.employee_smart_route_state where route_id = any(v_route_ids);
  delete from public.route_stops where route_id = any(v_route_ids);
  delete from public.route_order_state where route_id = any(v_route_ids);
  if to_regclass('public.route_map_cache') is not null then
    execute 'delete from public.route_map_cache where route_id = any($1)' using v_route_ids;
  end if;
  delete from public.route_order_audit where route_id = any(v_route_ids);

  v_visit_count := cardinality(v_visit_ids);
  delete from public.visits
  where id = any(v_visit_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.routes
  where id = any(v_route_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.jobs
  where id = any(v_job_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.quotes
  where customer_id = any(v_customer_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.properties
  where id = any(v_property_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  v_customer_count := cardinality(v_customer_ids);
  delete from public.customers
  where id = any(v_customer_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.employees
  where id = any(v_employee_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  delete from public.crews c
  where c.id = any(v_crew_ids)
    and coalesce(c.company_id, c.organization_id) = p_company_id
    and not exists (select 1 from public.employees e where e.crew_id = c.id)
    and not exists (select 1 from public.routes r where r.crew_id = c.id);

  delete from public.profiles
  where id = any(v_profile_ids)
    and coalesce(company_id, organization_id) = p_company_id;

  return jsonb_build_object(
    'purged', true,
    'customerCount', v_customer_count,
    'visitCount', v_visit_count,
    'profileIds', to_jsonb(v_profile_ids)
  );
end;
$function$;

revoke all on function public._purge_operational_simulation_public_graph(uuid, text) from public, anon, authenticated, service_role;

commit;
