begin;

-- A Visit may be moved from one canonical Route/date to another. The global
-- route_stops_visit_unique constraint means the stale source membership must be
-- removed before the target Route inserts the same visit_id. Keep the whole
-- operation inside this SECURITY DEFINER transaction and preserve route_stops
-- as the only durable membership/order writer.
create or replace function public.publish_canonical_route_daily(
  p_employee_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_ordered_job_ids uuid[],
  p_source_visit_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_sync jsonb;
  v_target_route_id uuid;
  v_target_company_id uuid;
  v_source_route_ids uuid[] := '{}'::uuid[];
  v_source_route_id uuid;
  v_source_company_id uuid;
  v_source_order uuid[] := '{}'::uuid[];
  v_versions jsonb := '{}'::jsonb;
begin
  -- Capture source Route IDs before V1 changes dated Visit membership. This is
  -- read-only; V1 remains the authorization and business-rule boundary.
  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_source_route_ids
  from public.visits v
  where v.route_id is not null
    and v.status::text <> 'cancelled'
    and (
      v.id = any(coalesce(p_source_visit_ids, '{}'::uuid[]))
      or (
        v.scheduled_date = p_route_date
        and v.job_id = any(coalesce(p_ordered_job_ids, '{}'::uuid[]))
      )
    );

  v_result := public.publish_canonical_route_daily_v1(
    p_employee_id,
    p_crew_id,
    p_route_date,
    p_ordered_job_ids,
    p_source_visit_ids
  );

  v_target_route_id := nullif(v_result ->> 'routeId', '')::uuid;

  -- V1 succeeded and therefore authorized the move. Enter the canonical write
  -- boundary before touching route_stops.
  perform set_config('damasio.canonical_route_write', '1', true);

  -- First detach moved Visits from their old canonical Routes and compact those
  -- Routes. Doing this before target insertion prevents route_stops_visit_unique
  -- collisions while keeping rollback atomic if any later step fails.
  foreach v_source_route_id in array v_source_route_ids loop
    if v_source_route_id is distinct from v_target_route_id then
      select coalesce(r.company_id, r.organization_id)
      into v_source_company_id
      from public.routes r
      where r.id = v_source_route_id;

      select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
      into v_source_order
      from public.route_stops s
      where s.route_id = v_source_route_id
        and exists (
          select 1
          from public.visits v
          where v.id = s.visit_id
            and v.route_id = v_source_route_id
            and v.status::text <> 'cancelled'
        );

      delete from public.route_stops
      where route_id = v_source_route_id;

      insert into public.route_stops(
        organization_id,
        company_id,
        route_id,
        visit_id,
        position,
        updated_at
      )
      select
        v_source_company_id,
        v_source_company_id,
        v_source_route_id,
        ordered.visit_id,
        ordered.position::integer,
        now()
      from unnest(v_source_order) with ordinality as ordered(visit_id, position);
    end if;
  end loop;

  -- Only after stale source memberships are gone do we materialize the target
  -- canonical Route. This preserves global visit_id uniqueness by construction.
  if v_target_route_id is not null then
    select coalesce(r.company_id, r.organization_id)
    into v_target_company_id
    from public.routes r
    where r.id = v_target_route_id;

    delete from public.route_stops
    where route_id = v_target_route_id;

    insert into public.route_stops(
      organization_id,
      company_id,
      route_id,
      visit_id,
      position,
      updated_at
    )
    select
      v_target_company_id,
      v_target_company_id,
      v_target_route_id,
      (item.value ->> 'id')::uuid,
      (item.value ->> 'routeOrder')::integer,
      now()
    from jsonb_array_elements(coalesce(v_result -> 'visits', '[]'::jsonb)) with ordinality item(value, ord)
    order by (item.value ->> 'routeOrder')::integer, item.ord;
  end if;

  perform set_config('damasio.canonical_route_write', '0', true);

  -- Refresh canonical version/audit state after both source and target stop sets
  -- are internally consistent.
  foreach v_source_route_id in array v_source_route_ids loop
    if v_source_route_id is distinct from v_target_route_id then
      v_sync := public.sync_canonical_route_stops_v2(
        v_source_route_id,
        'admin_route_publish_source'
      );
      v_versions := v_versions || jsonb_build_object(
        v_source_route_id::text,
        v_sync -> 'version'
      );
    end if;
  end loop;

  if v_target_route_id is not null then
    v_sync := public.sync_canonical_route_stops_v2(
      v_target_route_id,
      'admin_route_publish'
    );
    v_versions := v_versions || jsonb_build_object(
      v_target_route_id::text,
      v_sync -> 'version'
    );
  end if;

  return v_result || jsonb_build_object(
    'canonicalSource', 'route_stops_v2',
    'routeVersions', v_versions
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
