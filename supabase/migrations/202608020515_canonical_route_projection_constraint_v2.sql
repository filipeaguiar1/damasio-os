begin;

-- Compatibility refinement for the existing unique(route_id, route_order)
-- constraint, which also includes cancelled Visits. Clear every old projection
-- position first, then rebuild only the durable non-cancelled Route Stops.
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

  -- Clear cancelled positions too because the legacy database constraint is not partial.
  update public.visits
  set route_order = null
  where route_id = p_route_id;

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

  if exists (
    select 1
    from public.visits v
    where v.route_id = p_route_id
      and v.status::text = 'cancelled'
      and v.route_order is not null
  ) then
    raise exception 'Cancelled Visit positions were not cleared.';
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

notify pgrst, 'reload schema';

commit;
