begin;

-- Route Move V3
-- A temporary move changes only the selected dated Visit.
-- A permanent move changes the Job owner and every future Scheduled Visit.
-- Every affected source/destination route is rebuilt from its current Visit
-- membership so route_stops positions are always exactly 1..N, route versions
-- advance, and stale map geometry is invalidated.

create or replace function public.repair_canonical_route_membership_v3(
  p_route_id uuid,
  p_actor_profile_id uuid,
  p_source text default 'route_membership_repair_v3'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_company_id uuid;
  v_order uuid[] := '{}'::uuid[];
  v_result jsonb;
begin
  if p_route_id is null then
    return jsonb_build_object('saved', false, 'routeId', null);
  end if;

  select *
  into v_route
  from public.routes
  where id = p_route_id
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'routeId', p_route_id);
  end if;

  v_company_id := coalesce(v_route.company_id, v_route.organization_id);

  -- Preserve the surviving canonical order first. Any newly inserted Visit is
  -- appended using its compatibility order, then creation time as a stable tie.
  select coalesce(array_agg(item.visit_id order by
    item.has_stop desc,
    item.current_position,
    item.created_at,
    item.visit_id
  ), '{}'::uuid[])
  into v_order
  from (
    select
      v.id as visit_id,
      case when s.visit_id is null then 0 else 1 end as has_stop,
      coalesce(s.position, v.route_order, 2147483647) as current_position,
      v.created_at
    from public.visits v
    left join public.route_stops s
      on s.route_id = p_route_id
     and s.visit_id = v.id
    where v.route_id = p_route_id
      and v.status::text <> 'cancelled'
      and coalesce(v.company_id, v.organization_id) = v_company_id
  ) item;

  v_result := public.replace_canonical_route_order_v2(
    p_route_id,
    v_order,
    coalesce(nullif(trim(p_source), ''), 'route_membership_repair_v3'),
    p_actor_profile_id,
    null,
    true
  );

  -- Use the move-specific reason so the general map never serves old geometry
  -- while the route engine rebuilds the line from the new 1..N sequence.
  begin
    if cardinality(v_order) = 0 then
      delete from public.route_map_rebuild_queue where route_id = p_route_id;
      delete from public.route_map_cache where route_id = p_route_id;
    else
      perform public.queue_route_map_rebuild(
        p_route_id,
        v_company_id,
        coalesce(nullif(trim(p_source), ''), 'route_membership_repair_v3')
      );
    end if;
  exception
    when undefined_function or undefined_table then
      null;
  end;

  return v_result;
end;
$$;

-- Preserve whichever implementation is currently installed. This makes the
-- migration safe whether the database has the original assignment RPC or the
-- Route Stops V2 wrapper already applied.
do $$
begin
  if to_regprocedure(
    'public.move_canonical_visits_before_reindex_fix(uuid[],uuid,uuid,text)'
  ) is null then
    execute 'alter function public.move_canonical_visits(uuid[],uuid,uuid,text)
             rename to move_canonical_visits_before_reindex_fix';
  end if;
end
$$;

create or replace function public.move_canonical_visits(
  p_visit_ids uuid[],
  p_employee_id uuid,
  p_crew_id uuid,
  p_mode text default 'temporary'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_company_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, 'temporary')));
  v_selected_ids uuid[] := '{}'::uuid[];
  v_move_ids uuid[] := '{}'::uuid[];
  v_job_ids uuid[] := '{}'::uuid[];
  v_min_date date;
  v_selected_count integer;
  v_source_route_ids uuid[] := '{}'::uuid[];
  v_destination_route_ids uuid[] := '{}'::uuid[];
  v_route_id uuid;
  v_result jsonb;
  v_repair jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_affected uuid[] := '{}'::uuid[];
begin
  select *
  into v_profile
  from public.profiles
  where id = auth.uid()
    and active;

  if not found or v_profile.role::text not in ('admin', 'manager', 'master') then
    raise exception 'Only an active Admin can move canonical Visits.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);

  if v_mode not in ('temporary', 'permanent') then
    raise exception 'Move mode must be temporary or permanent.';
  end if;

  select coalesce(array_agg(distinct value), '{}'::uuid[])
  into v_selected_ids
  from unnest(coalesce(p_visit_ids, '{}'::uuid[])) value;

  if cardinality(v_selected_ids) = 0 then
    raise exception 'Select at least one canonical Visit.';
  end if;

  select
    count(*),
    min(v.scheduled_date),
    coalesce(array_agg(distinct v.job_id), '{}'::uuid[])
  into v_selected_count, v_min_date, v_job_ids
  from public.visits v
  where v.id = any(v_selected_ids)
    and coalesce(v.company_id, v.organization_id) = v_company_id;

  if v_selected_count <> cardinality(v_selected_ids) then
    raise exception 'One or more selected Visits do not belong to this company.';
  end if;

  if v_mode = 'permanent' then
    select coalesce(array_agg(v.id order by
      v.scheduled_date,
      v.route_order nulls last,
      v.created_at,
      v.id
    ), '{}'::uuid[])
    into v_move_ids
    from public.visits v
    where coalesce(v.company_id, v.organization_id) = v_company_id
      and v.job_id = any(v_job_ids)
      and v.status::text = 'scheduled'
      and v.scheduled_date >= v_min_date;
  else
    -- Temporary means this exact dated Visit only.
    v_move_ids := v_selected_ids;
  end if;

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_source_route_ids
  from public.visits v
  where v.id = any(v_move_ids)
    and v.route_id is not null
    and coalesce(v.company_id, v.organization_id) = v_company_id;

  v_result := public.move_canonical_visits_before_reindex_fix(
    p_visit_ids,
    p_employee_id,
    p_crew_id,
    v_mode
  );

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_destination_route_ids
  from public.visits v
  where v.id = any(v_move_ids)
    and v.route_id is not null
    and coalesce(v.company_id, v.organization_id) = v_company_id;

  -- Source routes are repaired first. This removes moved Visit IDs from their
  -- old route_stops rows before a destination route inserts those same IDs.
  foreach v_route_id in array v_source_route_ids loop
    v_repair := public.repair_canonical_route_membership_v3(
      v_route_id,
      v_profile.id,
      'route_move_source_v3'
    );
    v_versions := v_versions || jsonb_build_object(
      v_route_id::text,
      v_repair -> 'version'
    );
    v_affected := array_append(v_affected, v_route_id);
  end loop;

  foreach v_route_id in array v_destination_route_ids loop
    if not v_route_id = any(v_source_route_ids) then
      v_repair := public.repair_canonical_route_membership_v3(
        v_route_id,
        v_profile.id,
        'route_move_destination_v3'
      );
      v_versions := v_versions || jsonb_build_object(
        v_route_id::text,
        v_repair -> 'version'
      );
      v_affected := array_append(v_affected, v_route_id);
    end if;
  end loop;

  return v_result || jsonb_build_object(
    'canonicalSource', 'route_stops_v3',
    'routeVersions', v_versions,
    'affectedRouteIds', v_affected,
    'mapRefreshQueued', true
  );
end;
$$;

-- Repair routes already left with gaps by an earlier move. This includes stale
-- source membership, missing stops, non-sequential positions and projection drift.
do $$
declare
  v_route_id uuid;
begin
  for v_route_id in
    select r.id
    from public.routes r
    where
      exists (
        select 1 from public.route_stops s where s.route_id = r.id
      )
      or exists (
        select 1
        from public.visits v
        where v.route_id = r.id
          and v.status::text <> 'cancelled'
      )
    group by r.id
    having
      exists (
        select 1
        from (
          select
            s.position,
            row_number() over (order by s.position)::integer as expected_position
          from public.route_stops s
          where s.route_id = r.id
        ) positions
        where positions.position <> positions.expected_position
      )
      or exists (
        select 1
        from public.route_stops s
        left join public.visits v on v.id = s.visit_id
        where s.route_id = r.id
          and (
            v.id is null
            or v.route_id is distinct from r.id
            or v.status::text = 'cancelled'
          )
      )
      or exists (
        select 1
        from public.visits v
        where v.route_id = r.id
          and v.status::text <> 'cancelled'
          and not exists (
            select 1
            from public.route_stops s
            where s.route_id = r.id
              and s.visit_id = v.id
          )
      )
      or exists (
        select 1
        from public.route_stops s
        join public.visits v on v.id = s.visit_id
        where s.route_id = r.id
          and v.route_id = r.id
          and v.route_order is distinct from s.position
      )
  loop
    perform public.repair_canonical_route_membership_v3(
      v_route_id,
      null,
      'migration_route_move_repair_v3'
    );
  end loop;
end
$$;

revoke all on function public.repair_canonical_route_membership_v3(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.move_canonical_visits_before_reindex_fix(
  uuid[],uuid,uuid,text
) from public, anon, authenticated;
revoke all on function public.move_canonical_visits(uuid[],uuid,uuid,text)
  from public, anon;

grant execute on function public.repair_canonical_route_membership_v3(uuid,uuid,text)
  to service_role;
grant execute on function public.move_canonical_visits(uuid[],uuid,uuid,text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
