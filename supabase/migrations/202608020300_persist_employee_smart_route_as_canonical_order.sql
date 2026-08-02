-- Persist Employee Smart Route as the canonical route order.
-- The state row becomes the durable source for the order selected by the worker,
-- and visits.route_order remains the shared projection consumed by Admin and Employee.

create or replace function public.persist_employee_smart_route_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_allowed uuid[] := '{}'::uuid[];
  v_requested uuid[] := '{}'::uuid[];
  v_final uuid[] := '{}'::uuid[];
  v_visit_id uuid;
  v_index integer := 1;
begin
  if not new.active then
    return new;
  end if;

  select *
  into v_route
  from public.routes
  where id = new.route_id
  for update;

  if not found then
    raise exception 'Route not found while saving Smart Route.';
  end if;

  -- Never associate an applied Smart Route with the device/server date.
  -- The canonical route itself owns the date and crew.
  new.company_id := coalesce(v_route.company_id, v_route.organization_id);
  new.crew_id := v_route.crew_id;
  new.route_date := v_route.route_date;
  new.updated_at := now();

  select coalesce(array_agg(v.id order by v.route_order nulls last, v.id), '{}'::uuid[])
  into v_allowed
  from public.visits v
  where v.route_id = new.route_id
    and coalesce(v.company_id, v.organization_id) = new.company_id
    and v.status::text not in ('cancelled', 'missed');

  if cardinality(v_allowed) = 0 then
    raise exception 'This route has no active visits to save.';
  end if;

  -- Keep only unique visit ids that still belong to this route, preserving
  -- exactly the sequence chosen in Smart Route preview.
  select coalesce(array_agg(item.id order by item.position), '{}'::uuid[])
  into v_requested
  from (
    select distinct on (input.id)
      input.id,
      input.position
    from unnest(coalesce(new.applied_order, '{}'::uuid[]))
      with ordinality as input(id, position)
    where input.id = any(v_allowed)
    order by input.id, input.position
  ) item;

  -- Newly assigned or omitted active visits are appended without disturbing
  -- the saved Smart Route sequence.
  v_final := v_requested || array(
    select id
    from unnest(v_allowed) as current_visits(id)
    where not id = any(v_requested)
  );

  if cardinality(v_final) <> cardinality(v_allowed) then
    raise exception 'Smart Route could not be saved completely.';
  end if;

  -- Avoid route-order unique constraint collisions while changing positions.
  v_index := 1;
  foreach v_visit_id in array v_final loop
    update public.visits
    set route_order = 100000 + v_index,
        updated_at = now()
    where id = v_visit_id
      and route_id = new.route_id;
    v_index := v_index + 1;
  end loop;

  v_index := 1;
  foreach v_visit_id in array v_final loop
    update public.visits
    set route_order = v_index,
        updated_at = now()
    where id = v_visit_id
      and route_id = new.route_id;
    v_index := v_index + 1;
  end loop;

  new.applied_order := v_final;

  return new;
end;
$$;

drop trigger if exists persist_employee_smart_route_order_trigger
  on public.employee_smart_route_state;

create trigger persist_employee_smart_route_order_trigger
before insert or update of applied_order, active
on public.employee_smart_route_state
for each row
when (new.active)
execute function public.persist_employee_smart_route_order();

-- Repair active Smart Routes created before this invariant existed.
-- Touching applied_order invokes the trigger and makes the saved sequence the
-- canonical order visible to every Admin and Employee screen.
update public.employee_smart_route_state
set applied_order = applied_order,
    updated_at = now()
where active;

-- Ensure no old line can overwrite the newly persisted order while the route
-- geometry is rebuilt asynchronously.
update public.route_map_cache cache
set status = 'pending',
    geometry = null,
    bounds = null,
    distance_meters = null,
    duration_seconds = null,
    points_hash = null,
    provider = null,
    rebuilt_at = null,
    error_message = null,
    updated_at = now()
where exists (
  select 1
  from public.employee_smart_route_state state
  where state.route_id = cache.route_id
    and state.active
);

insert into public.route_map_rebuild_queue(
  route_id,
  company_id,
  reason,
  status,
  requested_at,
  updated_at
)
select
  state.route_id,
  state.company_id,
  'employee_smart_route_persisted',
  'pending',
  now(),
  now()
from public.employee_smart_route_state state
where state.active
on conflict (route_id) do update set
  company_id = excluded.company_id,
  reason = excluded.reason,
  status = 'pending',
  requested_at = now(),
  updated_at = now(),
  error_message = null;
