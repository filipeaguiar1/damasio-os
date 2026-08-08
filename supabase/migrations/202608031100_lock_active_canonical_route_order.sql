begin;

-- route_stops is the only durable order. While an active Smart Route exists,
-- legacy writers are forbidden from restoring an older visits.route_order.
-- Canonical writers explicitly opt in for the duration of their transaction.

create or replace function public.guard_active_canonical_route_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_id uuid;
  v_visit_id uuid;
  v_expected_position integer;
  v_active boolean := false;
begin
  if coalesce(current_setting('damasio.canonical_route_write', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_route_id := case when tg_op = 'DELETE' then old.route_id else new.route_id end;
  v_visit_id := case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;

  select state.active,
         array_position(state.applied_order, v_visit_id)
  into v_active, v_expected_position
  from public.employee_smart_route_state state
  where state.route_id = v_route_id
  order by state.updated_at desc
  limit 1;

  if not coalesce(v_active, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if v_expected_position is not null then
      raise exception 'Active canonical Route is protected from legacy deletion.';
    end if;
    return old;
  end if;

  if v_expected_position is null then
    raise exception 'Active canonical Route is protected from legacy membership changes.';
  end if;

  if new.position is distinct from v_expected_position then
    raise exception 'Active canonical Route is protected from legacy order overwrite.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_active_canonical_route_order_trigger on public.route_stops;
create trigger guard_active_canonical_route_order_trigger
before insert or update of route_id, visit_id, position or delete
on public.route_stops
for each row
execute function public.guard_active_canonical_route_order();

-- The service writer is the only writer used by the current Admin/Employee API.
-- It sets a transaction-local authorization flag before replacing the route.
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
  v_current_version integer;
  v_next_version integer;
  v_state public.employee_smart_route_state%rowtype;
  v_has_state boolean := false;
  v_has_property_id boolean := false;
begin
  perform set_config('damasio.canonical_route_write', '1', true);

  if p_actor_profile_id is null then
    raise exception 'A route apply actor is required.';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_actor_profile_id and active;
  if not found then raise exception 'Your session expired. Sign in again.'; end if;

  select * into v_route
  from public.routes
  where id = p_route_id
  for update;
  if not found then raise exception 'Route not found.'; end if;

  v_company_id := coalesce(v_route.company_id, v_route.organization_id);
  if v_company_id is null then raise exception 'Route company could not be resolved.'; end if;

  if coalesce(v_profile.company_id, v_profile.organization_id) is distinct from v_company_id then
    raise exception 'You do not have access to this route.';
  end if;

  if v_profile.role::text = 'employee' then
    select * into v_employee
    from public.employees
    where profile_id = v_profile.id
      and active
      and coalesce(company_id, organization_id) = v_company_id
    for update;
    if not found then raise exception 'No active Employee is linked to this login.'; end if;
    if v_route.crew_id is distinct from v_employee.crew_id
       and not exists (
         select 1 from public.visits v
         where v.route_id = p_route_id
           and v.assigned_employee_id = v_employee.id
       ) then
      raise exception 'This route is not assigned to this Employee.';
    end if;
  elsif v_profile.role::text not in ('admin', 'manager', 'master') then
    raise exception 'This account cannot change route order.';
  end if;

  if exists (
    select 1 from public.visits v
    where v.route_id = p_route_id and v.status::text = 'in_progress'
  ) then
    raise exception 'Finish the active house before changing this route.';
  end if;

  select coalesce(array_agg(v.id order by coalesce(s.position, v.route_order, 2147483647), v.created_at, v.id), '{}'::uuid[])
  into v_allowed
  from public.visits v
  left join public.route_stops s on s.route_id = v.route_id and s.visit_id = v.id
  where v.route_id = p_route_id
    and coalesce(v.company_id, v.organization_id) = v_company_id
    and v.status::text <> 'cancelled';

  select coalesce(array_agg(item.id order by item.position), '{}'::uuid[])
  into v_requested
  from (
    select distinct on (input.id) input.id, input.position
    from unnest(coalesce(p_ordered_visit_ids, '{}'::uuid[])) with ordinality as input(id, position)
    order by input.id, input.position
  ) item;

  if cardinality(v_requested) <> cardinality(coalesce(p_ordered_visit_ids, '{}'::uuid[])) then
    raise exception 'The reviewed route contains duplicate houses.';
  end if;
  if cardinality(v_allowed) = 0 then raise exception 'This route has no houses.'; end if;
  if cardinality(v_requested) <> cardinality(v_allowed)
     or exists (select 1 from unnest(v_requested) requested(id) where not requested.id = any(v_allowed))
     or exists (select 1 from unnest(v_allowed) allowed(id) where not allowed.id = any(v_requested)) then
    raise exception 'The reviewed route must contain every non-cancelled house exactly once.';
  end if;

  insert into public.route_order_state(route_id, company_id, version, last_source, last_actor_profile_id, updated_at)
  values (p_route_id, v_company_id, 1, 'initialization', v_profile.id, now())
  on conflict (route_id) do nothing;

  select state.version into v_current_version
  from public.route_order_state state
  where state.route_id = p_route_id
  for update;

  if p_expected_version is not null and v_current_version is distinct from p_expected_version then
    raise exception 'Route changed on another device. Refresh and review it again.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_previous
  from public.route_stops s
  where s.route_id = p_route_id;
  if cardinality(v_previous) = 0 then v_previous := v_allowed; end if;

  -- Move old positions out of the unique range, then upsert the requested order.
  update public.route_stops
  set position = position + 1000000, updated_at = now()
  where route_id = p_route_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_stops' and column_name = 'property_id'
  ) into v_has_property_id;

  if v_has_property_id then
    insert into public.route_stops(company_id, organization_id, route_id, visit_id, property_id, position, updated_at)
    select v_company_id, v_company_id, p_route_id, requested.id, v.property_id, requested.position::integer, now()
    from unnest(v_requested) with ordinality as requested(id, position)
    join public.visits v on v.id = requested.id
    on conflict (route_id, visit_id) do update set
      company_id = excluded.company_id,
      organization_id = excluded.organization_id,
      property_id = excluded.property_id,
      position = excluded.position,
      updated_at = excluded.updated_at;
  else
    insert into public.route_stops(company_id, organization_id, route_id, visit_id, position, updated_at)
    select v_company_id, v_company_id, p_route_id, requested.id, requested.position::integer, now()
    from unnest(v_requested) with ordinality as requested(id, position)
    on conflict (route_id, visit_id) do update set
      company_id = excluded.company_id,
      organization_id = excluded.organization_id,
      position = excluded.position,
      updated_at = excluded.updated_at;
  end if;

  delete from public.route_stops s
  where s.route_id = p_route_id and not (s.visit_id = any(v_requested));

  update public.route_order_state
  set version = version + 1,
      last_source = coalesce(nullif(trim(p_source), ''), 'route_order_update'),
      last_actor_profile_id = v_profile.id,
      updated_at = now()
  where route_id = p_route_id
  returning version into v_next_version;

  select * into v_state
  from public.employee_smart_route_state
  where route_id = p_route_id
  for update;
  v_has_state := found;

  insert into public.employee_smart_route_state(
    company_id, route_id, crew_id, route_date, original_order, applied_order,
    origin_label, origin_latitude, origin_longitude, active,
    applied_by_profile_id, applied_at, route_version, updated_at
  ) values (
    v_company_id, p_route_id, v_route.crew_id, v_route.route_date,
    case when v_has_state and v_state.active then v_state.original_order else v_previous end,
    v_requested, coalesce(p_origin_label, ''), p_origin_latitude, p_origin_longitude,
    true, v_profile.id, now(), v_next_version, now()
  ) on conflict (route_id) do update set
    company_id = excluded.company_id,
    crew_id = excluded.crew_id,
    route_date = excluded.route_date,
    original_order = case when public.employee_smart_route_state.active then public.employee_smart_route_state.original_order else excluded.original_order end,
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

  insert into public.route_order_audit(company_id, route_id, actor_profile_id, source, previous_order, next_order, route_version)
  values (v_company_id, p_route_id, v_profile.id, coalesce(nullif(trim(p_source), ''), 'route_order_update'), v_previous, v_requested, v_next_version);

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_stored
  from public.route_stops s
  where s.route_id = p_route_id;

  if v_stored is distinct from v_requested then
    raise exception 'Route verification failed. requested=%, stored=%', v_requested, v_stored;
  end if;

  begin
    perform public.queue_route_map_rebuild(p_route_id, v_company_id, 'canonical_route_locked_writer');
  exception when undefined_function or undefined_table then null;
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
