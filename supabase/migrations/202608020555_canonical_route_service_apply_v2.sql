begin;

-- Service-backed canonical route writer used by the mobile API after it has
-- authenticated and authorized the Employee. This avoids stale auth-RPC paths
-- returning success without the official route_stops order being visible to all
-- readers immediately after Apply.

create or replace function public.apply_canonical_route_order_v2_service(
  p_route_id uuid,
  p_ordered_visit_ids uuid[],
  p_origin_label text default '',
  p_origin_latitude double precision default null,
  p_origin_longitude double precision default null,
  p_expected_version integer default null,
  p_actor_profile_id uuid default null,
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
  v_allowed uuid[] := '{}'::uuid[];
  v_requested uuid[] := '{}'::uuid[];
  v_previous uuid[] := '{}'::uuid[];
  v_stored uuid[] := '{}'::uuid[];
  v_projected uuid[] := '{}'::uuid[];
  v_current_version integer;
  v_next_version integer;
  v_state public.employee_smart_route_state%rowtype;
  v_has_state boolean := false;
  v_has_property_id boolean := false;
begin
  if p_actor_profile_id is null then
    raise exception 'A route apply actor is required.';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_actor_profile_id
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
  if v_company_id is null then
    raise exception 'Route company could not be resolved.';
  end if;

  if coalesce(v_profile.company_id, v_profile.organization_id) is distinct from v_company_id then
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

  if cardinality(v_allowed) = 0 then
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
    v_profile.id,
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

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'route_stops'
      and column_name = 'property_id'
  )
  into v_has_property_id;

  if v_has_property_id then
    insert into public.route_stops(
      company_id,
      organization_id,
      route_id,
      visit_id,
      property_id,
      position,
      updated_at
    )
    select
      v_company_id,
      v_company_id,
      p_route_id,
      requested.id,
      v.property_id,
      requested.position::integer,
      now()
    from unnest(v_requested)
      with ordinality as requested(id, position)
    join public.visits v on v.id = requested.id;
  else
    insert into public.route_stops(
      company_id,
      organization_id,
      route_id,
      visit_id,
      position,
      updated_at
    )
    select
      v_company_id,
      v_company_id,
      p_route_id,
      requested.id,
      requested.position::integer,
      now()
    from unnest(v_requested)
      with ordinality as requested(id, position);
  end if;

  update public.visits v
  set route_order = 100000 + requested.position::integer,
      updated_at = now()
  from unnest(v_requested)
    with ordinality as requested(id, position)
  where v.route_id = p_route_id
    and v.id = requested.id;

  update public.visits v
  set route_order = requested.position::integer,
      updated_at = now()
  from unnest(v_requested)
    with ordinality as requested(id, position)
  where v.route_id = p_route_id
    and v.id = requested.id;

  update public.visits
  set route_order = null,
      updated_at = now()
  where route_id = p_route_id
    and status::text = 'cancelled';

  update public.route_order_state
  set
    version = version + 1,
    last_source = coalesce(nullif(trim(p_source), ''), 'route_order_update'),
    last_actor_profile_id = v_profile.id,
    updated_at = now()
  where route_id = p_route_id
  returning version into v_next_version;

  select *
  into v_state
  from public.employee_smart_route_state
  where route_id = p_route_id
  for update;
  v_has_state := found;

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
    v_requested,
    coalesce(p_origin_label, ''),
    p_origin_latitude,
    p_origin_longitude,
    true,
    v_profile.id,
    now(),
    v_next_version,
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
    v_profile.id,
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
    raise exception
      'Route verification failed. requested=%, stored=%, projected=%',
      v_requested,
      v_stored,
      v_projected;
  end if;

  begin
    perform public.queue_route_map_rebuild(
      p_route_id,
      v_company_id,
      'canonical_route_service_apply_v2'
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

revoke all on function public.apply_canonical_route_order_v2_service(
  uuid, uuid[], text, double precision, double precision, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.apply_canonical_route_order_v2_service(
  uuid, uuid[], text, double precision, double precision, integer, uuid, text
) to service_role;

notify pgrst, 'reload schema';

commit;
