begin;

create or replace function public.cleanup_operational_simulation_routes(
  p_company_id uuid,
  p_namespace text,
  p_crew_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_requested_count integer := coalesce(cardinality(p_crew_ids), 0);
  v_valid_count integer := 0;
  v_route_ids uuid[] := '{}'::uuid[];
  v_deleted_count integer := 0;
  v_namespace text := lower(trim(coalesce(p_namespace, '')));
  v_company_token text := left(replace(p_company_id::text, '-', ''), 8);
  v_email_pattern text;
begin
  if p_company_id is null then
    raise exception 'Advanced simulation Route cleanup requires a company.';
  end if;

  if v_namespace = '' or v_namespace !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'Advanced simulation Route cleanup received an invalid namespace.';
  end if;

  if v_requested_count = 0 then
    return jsonb_build_object('deleted', true, 'routeCount', 0);
  end if;

  if (
    select count(distinct value)
    from unnest(p_crew_ids) value
  ) <> v_requested_count then
    raise exception 'Advanced simulation Route cleanup received duplicate Crew IDs.';
  end if;

  v_email_pattern := 'ops-sim-v2-' || v_company_token || '-' || v_namespace || '-%@4everseasons.test';

  select count(*)
  into v_valid_count
  from public.crews c
  where c.id = any(p_crew_ids)
    and coalesce(c.company_id, c.organization_id) = p_company_id
    and exists (
      select 1
      from public.employees e
      where e.crew_id = c.id
        and coalesce(e.company_id, e.organization_id) = p_company_id
        and lower(coalesce(e.email, '')) like v_email_pattern
    );

  if v_valid_count <> v_requested_count then
    raise exception 'Advanced simulation Route cleanup refused non-simulation Crews.';
  end if;

  select coalesce(array_agg(r.id), '{}'::uuid[])
  into v_route_ids
  from public.routes r
  where r.crew_id = any(p_crew_ids)
    and coalesce(r.company_id, r.organization_id) = p_company_id;

  if cardinality(v_route_ids) = 0 then
    return jsonb_build_object('deleted', true, 'routeCount', 0);
  end if;

  if exists (
    select 1
    from public.visits v
    where v.route_id = any(v_route_ids)
      and coalesce(v.company_id, v.organization_id) = p_company_id
  ) then
    raise exception 'Advanced simulation Route cleanup refused Routes that still contain Visits.';
  end if;

  delete from public.routes r
  where r.id = any(v_route_ids)
    and coalesce(r.company_id, r.organization_id) = p_company_id;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> cardinality(v_route_ids) then
    raise exception 'Advanced simulation Route cleanup was incomplete: expected %, deleted %.', cardinality(v_route_ids), v_deleted_count;
  end if;

  return jsonb_build_object('deleted', true, 'routeCount', v_deleted_count);
end;
$function$;

revoke all on function public.cleanup_operational_simulation_routes(uuid, text, uuid[]) from public;
revoke all on function public.cleanup_operational_simulation_routes(uuid, text, uuid[]) from anon;
revoke all on function public.cleanup_operational_simulation_routes(uuid, text, uuid[]) from authenticated;
grant execute on function public.cleanup_operational_simulation_routes(uuid, text, uuid[]) to service_role;

commit;
