begin;

-- Every route writer converges here. No application endpoint may write
-- visits.route_order or route_stops directly.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'route_stops_visit_unique'
      and conrelid = 'public.route_stops'::regclass
  ) then
    alter table public.route_stops
      add constraint route_stops_visit_unique unique (visit_id);
  end if;
end
$$;

create or replace function public.replace_canonical_route_order_v2(
  p_route_id uuid,
  p_ordered_visit_ids uuid[],
  p_source text,
  p_actor_profile_id uuid,
  p_expected_version integer default null,
  p_allow_empty boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_company_id uuid;
  v_allowed uuid[] := '{}'::uuid[];
  v_requested uuid[] := '{}'::uuid[];
  v_previous uuid[] := '{}'::uuid[];
  v_stored uuid[] := '{}'::uuid[];
  v_projected uuid[] := '{}'::uuid[];
  v_current_version integer;
  v_next_version integer;
begin
  select *
  into v_route
  from public.routes
  where id = p_route_id
  for update;

  if not found then
    raise exception 'Route not found.';
  end if;

  v_company_id := coalesce(v_route.company_id, v_route.organization_id);

  select coalesce(array_agg(v.id order by
    coalesce(s.position, v.route_order, 2147483647),
    v.created_at,
    v.id
  ), '{}'::uuid[])
  into v_allowed
  from public.visits v
  left join public.route_stops s
    on s.route_id = v.route_id
   and s.visit_id = v.id
  where v.route_id = p_route_id
    and coalesce(v.company_id, v.organization_id) = v_company_id
    and v.status::text <> 'cancelled';

  select coalesce(array_agg(item.id order by item.position), '{}'::uuid[])
  into v_requested
  from (
    select distinct on (input.id)
      input.id,
      input.position
    from unnest(coalesce(p_ordered_visit_ids, '{}'::uuid[]))
      with ordinality as input(id, position)
    order by input.id, input.position
  ) item;

  if cardinality(v_requested) <> cardinality(coalesce(p_ordered_visit_ids, '{}'::uuid[])) then
    raise exception 'The reviewed route contains duplicate houses.';
  end if;

  if not p_allow_empty and cardinality(v_allowed) = 0 then
    raise exception 'This route has no houses.';
  end if;

  if cardinality(v_requested) <> cardinality(v_allowed)
     or exists (
       select 1
       from unnest(v_requested) requested(id)
       where not requested.id = any(v_allowed)
     )
     or exists (
       select 1
       from unnest(v_allowed) allowed(id)
       where not allowed.id = any(v_requested)
     ) then
    raise exception 'The reviewed route must contain every non-cancelled house exactly once.';
  end if;

  insert into public.route_order_state(
    route_id,
    company_id,
    version,
    last_source,
    last_actor_profile_id,
    updated_at
  )
  values (
    p_route_id,
    v_company_id,
    1,
    'initialization',
    p_actor_profile_id,
    now()
  )
  on conflict (route_id) do nothing;

  select state.version
  into v_current_version
  from public.route_order_state state
  where state.route_id = p_route_id
  for update;

  if p_expected_version is not null
     and v_current_version is distinct from p_expected_version then
    raise exception 'Route changed on another device. Refresh and review it again.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_previous
  from public.route_stops s
  where s.route_id = p_route_id;

  if cardinality(v_previous) = 0 then
    v_previous := v_allowed;
  end if;

  delete from public.route_stops
  where route_id = p_route_id;

  insert into public.route_stops(
    company_id,
    route_id,
    visit_id,
    position,
    updated_at
  )
  select
    v_company_id,
    p_route_id,
    requested.id,
    requested.position::integer,
    now()
  from unnest(v_requested)
    with ordinality as requested(id, position);

  -- The compatibility projection is written in this same transaction.
  update public.visits
  set route_order = null
  where route_id = p_route_id
    and status::text <> 'cancelled';

  update public.visits v
  set route_order = s.position
  from public.route_stops s
  where s.route_id = p_route_id
    and s.visit_id = v.id
    and v.route_id = p_route_id;

  update public.route_order_state
  set
    version = version + 1,
    last_source = coalesce(nullif(trim(p_source), ''), 'route_order_update'),
    last_actor_profile_id = p_actor_profile_id,
    updated_at = now()
  where route_id = p_route_id
  returning version into v_next_version;

  insert into public.route_order_audit(
    company_id,
    route_id,
    actor_profile_id,
    source,
    previous_order,
    next_order,
    route_version
  )
  values (
    v_company_id,
    p_route_id,
    p_actor_profile_id,
    coalesce(nullif(trim(p_source), ''), 'route_order_update'),
    v_previous,
    v_requested,
    v_next_version
  );

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_stored
  from public.route_stops s
  where s.route_id = p_route_id;

  select coalesce(array_agg(v.id order by v.route_order), '{}'::uuid[])
  into v_projected
  from public.visits v
  where v.route_id = p_route_id
    and v.status::text <> 'cancelled';

  if v_stored is distinct from v_requested
     or v_projected is distinct from v_requested then
    raise exception 'Route verification failed. Nothing was changed.';
  end if;

  begin
    perform public.queue_route_map_rebuild(
      p_route_id,
      v_company_id,
      'canonical_route_stops_v2'
    );
  exception
    when undefined_function or undefined_table then
      null;
  end;

  return jsonb_build_object(
    'saved', true,
    'routeId', p_route_id,
    'count', cardinality(v_requested),
    'version', v_next_version,
    'previousOrder', v_previous,
    'appliedOrder', v_requested
  );
end;
$$;

create or replace function public.sync_canonical_route_stops_v2(
  p_route_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid[];
begin
  select coalesce(array_agg(v.id order by
    v.route_order nulls last,
    v.created_at,
    v.id
  ), '{}'::uuid[])
  into v_order
  from public.visits v
  where v.route_id = p_route_id
    and v.status::text <> 'cancelled';

  return public.replace_canonical_route_order_v2(
    p_route_id,
    v_order,
    p_source,
    auth.uid(),
    null,
    true
  );
end;
$$;

-- Supersede the first implementation with the central writer above. Missed
-- houses remain durable route stops; only cancelled Visits leave the route.
create or replace function public.apply_canonical_route_order_v2(
  p_route_id uuid,
  p_ordered_visit_ids uuid[],
  p_origin_label text default '',
  p_origin_latitude double precision default null,
  p_origin_longitude double precision default null,
  p_expected_version integer default null,
  p_source text default 'employee_smart_route'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_employee public.employees%rowtype;
  v_route public.routes%rowtype;
  v_company_id uuid;
  v_result jsonb;
  v_previous uuid[];
  v_state public.employee_smart_route_state%rowtype;
  v_has_state boolean := false;
begin
  select *
  into v_profile
  from public.profiles
  where id = auth.uid()
    and active;

  if not found then
    raise exception 'Your session expired. Sign in again.';
  end if;

  select *
  into v_route
  from public.routes
  where id = p_route_id
  for update;

  if not found then
    raise exception 'Route not found.';
  end if;

  v_company_id := coalesce(v_route.company_id, v_route.organization_id);

  if coalesce(v_profile.company_id, v_profile.organization_id) is distinct from v_company_id
     and not public.master_has_company_access(v_company_id, 'operational_support') then
    raise exception 'You do not have access to this route.';
  end if;

  if v_profile.role::text = 'employee' then
    select *
    into v_employee
    from public.employees
    where profile_id = v_profile.id
      and active
      and coalesce(company_id, organization_id) = v_company_id
    for update;

    if not found then
      raise exception 'No active Employee is linked to this login.';
    end if;

    if v_route.crew_id is distinct from v_employee.crew_id
       and not exists (
         select 1
         from public.visits v
         where v.route_id = p_route_id
           and v.assigned_employee_id = v_employee.id
       ) then
      raise exception 'This route is not assigned to this Employee.';
    end if;
  elsif v_profile.role::text not in ('admin', 'manager', 'master') then
    raise exception 'This account cannot change route order.';
  end if;

  if exists (
    select 1
    from public.visits v
    where v.route_id = p_route_id
      and v.status::text = 'in_progress'
  ) then
    raise exception 'Finish the active house before changing this route.';
  end if;

  v_result := public.replace_canonical_route_order_v2(
    p_route_id,
    p_ordered_visit_ids,
    p_source,
    v_profile.id,
    p_expected_version,
    false
  );

  v_previous := array(
    select jsonb_array_elements_text(v_result -> 'previousOrder')::uuid
  );

  select *
  into v_state
  from public.employee_smart_route_state
  where route_id = p_route_id
  for update;
  v_has_state := found;

  -- Retained only for origin metadata and backward-compatible reads.
  insert into public.employee_smart_route_state(
    company_id,
    route_id,
    crew_id,
    route_date,
    original_order,
    applied_order,
    origin_label,
    origin_latitude,
    origin_longitude,
    active,
    applied_by_profile_id,
    applied_at,
    route_version,
    updated_at
  )
  values (
    v_company_id,
    p_route_id,
    v_route.crew_id,
    v_route.route_date,
    case when v_has_state and v_state.active then v_state.original_order else v_previous end,
    p_ordered_visit_ids,
    coalesce(p_origin_label, ''),
    p_origin_latitude,
    p_origin_longitude,
    true,
    v_profile.id,
    now(),
    (v_result ->> 'version')::integer,
    now()
  )
  on conflict (route_id) do update set
    company_id = excluded.company_id,
    crew_id = excluded.crew_id,
    route_date = excluded.route_date,
    original_order = case
      when employee_smart_route_state.active
        then employee_smart_route_state.original_order
      else excluded.original_order
    end,
    applied_order = excluded.applied_order,
    origin_label = excluded.origin_label,
    origin_latitude = excluded.origin_latitude,
    origin_longitude = excluded.origin_longitude,
    active = true,
    applied_by_profile_id = excluded.applied_by_profile_id,
    applied_at = excluded.applied_at,
    restored_at = null,
    restored_by_profile_id = null,
    route_version = excluded.route_version,
    updated_at = excluded.updated_at;

  return v_result;
end;
$$;

create or replace function public.restore_canonical_route_order_v2(
  p_route_id uuid,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.employee_smart_route_state%rowtype;
  v_current uuid[] := '{}'::uuid[];
  v_final uuid[] := '{}'::uuid[];
  v_result jsonb;
begin
  select *
  into v_state
  from public.employee_smart_route_state
  where route_id = p_route_id
    and active
  for update;

  if not found then
    return jsonb_build_object(
      'restored', false,
      'routeId', p_route_id
    );
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_current
  from public.route_stops s
  join public.visits v on v.id = s.visit_id
  where s.route_id = p_route_id
    and v.status::text <> 'cancelled';

  if cardinality(v_current) = 0 then
    select coalesce(array_agg(v.id order by v.route_order nulls last, v.created_at, v.id), '{}'::uuid[])
    into v_current
    from public.visits v
    where v.route_id = p_route_id
      and v.status::text <> 'cancelled';
  end if;

  v_final := array(
    select id
    from unnest(v_state.original_order) with ordinality original(id, position)
    where id = any(v_current)
    order by position
  );
  v_final := v_final || array(
    select id
    from unnest(v_current) with ordinality current_order(id, position)
    where not id = any(v_final)
    order by position
  );

  v_result := public.apply_canonical_route_order_v2(
    p_route_id,
    v_final,
    v_state.origin_label,
    v_state.origin_latitude,
    v_state.origin_longitude,
    p_expected_version,
    'employee_smart_route_restore'
  );

  update public.employee_smart_route_state
  set
    active = false,
    restored_at = now(),
    restored_by_profile_id = auth.uid(),
    route_version = (v_result ->> 'version')::integer,
    updated_at = now()
  where route_id = p_route_id;

  return v_result || jsonb_build_object('restored', true);
end;
$$;

-- Preserve old client RPC names, but make them thin wrappers.
create or replace function public.apply_employee_smart_route(
  p_route_id uuid,
  p_original_order uuid[],
  p_applied_order uuid[],
  p_origin_label text,
  p_origin_latitude double precision,
  p_origin_longitude double precision,
  p_expected_version integer default null
)
returns table(route_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.apply_canonical_route_order_v2(
    p_route_id,
    p_applied_order,
    p_origin_label,
    p_origin_latitude,
    p_origin_longitude,
    p_expected_version,
    'employee_smart_route_compat'
  );
  route_version := (v_result ->> 'version')::integer;
  return next;
end;
$$;

create or replace function public.restore_employee_smart_route(
  p_route_id uuid,
  p_expected_version integer default null
)
returns table(restored boolean, route_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.restore_canonical_route_order_v2(
    p_route_id,
    p_expected_version
  );
  restored := coalesce((v_result ->> 'restored')::boolean, false);
  route_version := nullif(v_result ->> 'version', '')::integer;
  return next;
end;
$$;

-- Wrap the existing Admin publisher. The legacy body still owns Customer/Job/
-- Visit creation rules; this wrapper makes its final route state canonical.
alter function public.publish_canonical_route_daily(
  uuid, uuid, date, uuid[], uuid[]
) rename to publish_canonical_route_daily_v1;

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
  v_source_route_ids uuid[] := '{}'::uuid[];
  v_source_route_id uuid;
  v_versions jsonb := '{}'::jsonb;
begin
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

-- Recreate the compatibility publisher so its dependency points to the V2 wrapper.
create or replace function public.publish_canonical_route(
  p_employee_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_ordered_job_ids uuid[],
  p_source_visit_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.publish_canonical_route_daily(
    p_employee_id,
    p_crew_id,
    p_route_date,
    p_ordered_job_ids,
    p_source_visit_ids
  )
$$;

-- Wrap temporary/permanent movement and synchronize source routes before
-- destinations so a Visit can never exist in two route_stops rows.
alter function public.move_canonical_visits(
  uuid[], uuid, uuid, text
) rename to move_canonical_visits_v1;

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
  v_mode text := lower(trim(coalesce(p_mode, 'temporary')));
  v_selected_ids uuid[] := '{}'::uuid[];
  v_move_ids uuid[] := '{}'::uuid[];
  v_job_ids uuid[] := '{}'::uuid[];
  v_min_date date;
  v_source_route_ids uuid[] := '{}'::uuid[];
  v_destination_route_ids uuid[] := '{}'::uuid[];
  v_route_id uuid;
  v_result jsonb;
  v_sync jsonb;
  v_versions jsonb := '{}'::jsonb;
begin
  select coalesce(array_agg(distinct value), '{}'::uuid[])
  into v_selected_ids
  from unnest(coalesce(p_visit_ids, '{}'::uuid[])) value;

  select min(v.scheduled_date), coalesce(array_agg(distinct v.job_id), '{}'::uuid[])
  into v_min_date, v_job_ids
  from public.visits v
  where v.id = any(v_selected_ids);

  if v_mode = 'permanent' then
    select coalesce(array_agg(v.id order by v.scheduled_date, v.route_order nulls last, v.created_at, v.id), '{}'::uuid[])
    into v_move_ids
    from public.visits v
    where v.job_id = any(v_job_ids)
      and v.status::text = 'scheduled'
      and v.scheduled_date >= v_min_date;
  else
    v_move_ids := v_selected_ids;
  end if;

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_source_route_ids
  from public.visits v
  where v.id = any(v_move_ids)
    and v.route_id is not null;

  v_result := public.move_canonical_visits_v1(
    p_visit_ids,
    p_employee_id,
    p_crew_id,
    p_mode
  );

  select coalesce(array_agg(distinct v.route_id), '{}'::uuid[])
  into v_destination_route_ids
  from public.visits v
  where v.id = any(v_move_ids)
    and v.route_id is not null;

  foreach v_route_id in array v_source_route_ids loop
    v_sync := public.sync_canonical_route_stops_v2(
      v_route_id,
      'route_move_source'
    );
    v_versions := v_versions || jsonb_build_object(
      v_route_id::text,
      v_sync -> 'version'
    );
  end loop;

  foreach v_route_id in array v_destination_route_ids loop
    if not v_route_id = any(v_source_route_ids) then
      v_sync := public.sync_canonical_route_stops_v2(
        v_route_id,
        'route_move_destination'
      );
      v_versions := v_versions || jsonb_build_object(
        v_route_id::text,
        v_sync -> 'version'
      );
    end if;
  end loop;

  return v_result || jsonb_build_object(
    'canonicalSource', 'route_stops_v2',
    'routeVersions', v_versions
  );
end;
$$;

revoke all on function public.replace_canonical_route_order_v2(
  uuid, uuid[], text, uuid, integer, boolean
) from public, anon, authenticated;
revoke all on function public.sync_canonical_route_stops_v2(uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_canonical_route_daily_v1(
  uuid, uuid, date, uuid[], uuid[]
) from public, anon, authenticated;
revoke all on function public.move_canonical_visits_v1(
  uuid[], uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.apply_canonical_route_order_v2(
  uuid, uuid[], text, double precision, double precision, integer, text
) to authenticated, service_role;
grant execute on function public.restore_canonical_route_order_v2(uuid, integer)
  to authenticated, service_role;
grant execute on function public.apply_employee_smart_route(
  uuid, uuid[], uuid[], text, double precision, double precision, integer
) to authenticated, service_role;
grant execute on function public.restore_employee_smart_route(uuid, integer)
  to authenticated, service_role;
grant execute on function public.publish_canonical_route_daily(
  uuid, uuid, date, uuid[], uuid[]
) to authenticated, service_role;
grant execute on function public.publish_canonical_route(
  uuid, uuid, date, uuid[], uuid[]
) to authenticated, service_role;
grant execute on function public.move_canonical_visits(
  uuid[], uuid, uuid, text
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
