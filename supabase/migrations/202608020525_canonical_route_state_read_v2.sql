begin;

-- Any Admin publication, Visit move or reset invalidates an older Employee
-- Smart Route session. The canonical order remains available, but it is no
-- longer presented as an active optimization from a stale device.
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
  v_result jsonb;
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

  v_result := public.replace_canonical_route_order_v2(
    p_route_id,
    v_order,
    p_source,
    auth.uid(),
    null,
    true
  );

  update public.employee_smart_route_state
  set
    active = false,
    route_version = (v_result ->> 'version')::integer,
    updated_at = now()
  where route_id = p_route_id;

  return v_result;
end;
$$;

-- Always return one canonical state row for an accessible Route. This prevents
-- an inactive database state from falling back to stale localStorage data.
create or replace function public.get_employee_smart_route_state(p_route_id uuid)
returns table(
  route_id uuid,
  crew_id uuid,
  route_date date,
  original_order uuid[],
  applied_order uuid[],
  origin_label text,
  origin_latitude double precision,
  origin_longitude double precision,
  applied_at timestamptz,
  active boolean,
  route_version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_state public.employee_smart_route_state%rowtype;
  v_order uuid[] := '{}'::uuid[];
  v_version integer := 1;
  v_state_active boolean := false;
begin
  if not public.employee_can_use_route(p_route_id) then
    raise exception 'You do not have access to this route.';
  end if;

  select *
  into v_route
  from public.routes
  where id = p_route_id;

  if not found then
    raise exception 'Route not found.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_order
  from public.route_stops s
  where s.route_id = p_route_id;

  if cardinality(v_order) = 0 then
    select coalesce(array_agg(v.id order by v.route_order nulls last, v.created_at, v.id), '{}'::uuid[])
    into v_order
    from public.visits v
    where v.route_id = p_route_id
      and v.status::text <> 'cancelled';
  end if;

  select coalesce(state.version, 1)
  into v_version
  from public.route_order_state state
  where state.route_id = p_route_id;
  v_version := coalesce(v_version, 1);

  select *
  into v_state
  from public.employee_smart_route_state state
  where state.route_id = p_route_id;

  if found then
    v_state_active := v_state.active
      and coalesce(v_state.route_version, 0) = v_version;
  end if;

  return query
  select
    v_route.id,
    v_route.crew_id,
    v_route.route_date,
    case
      when v_state.route_id is not null then coalesce(v_state.original_order, v_order)
      else v_order
    end,
    v_order,
    coalesce(v_state.origin_label, ''),
    v_state.origin_latitude,
    v_state.origin_longitude,
    coalesce(v_state.applied_at, now()),
    v_state_active,
    v_version;
end;
$$;

grant execute on function public.get_employee_smart_route_state(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
