begin;

-- Some production databases already had an earlier route_stops table keyed by
-- organization_id/property_id. Canonical Route Stops V2 uses company_id as the
-- write-side tenant key. This compatibility patch keeps both tenant columns in
-- sync and replaces the internal writer with a projection that works on either
-- table shape.

alter table public.route_stops
  add column if not exists company_id uuid;

alter table public.route_stops
  add column if not exists organization_id uuid;

update public.route_stops s
set
  company_id = coalesce(
    s.company_id,
    s.organization_id,
    r.company_id,
    r.organization_id,
    v.company_id,
    v.organization_id
  ),
  organization_id = coalesce(
    s.organization_id,
    s.company_id,
    r.company_id,
    r.organization_id,
    v.company_id,
    v.organization_id
  )
from public.routes r, public.visits v
where s.route_id = r.id
  and s.visit_id = v.id
  and (
    s.company_id is null
    or s.organization_id is null
  );

alter table public.route_stops
  alter column company_id drop not null;

alter table public.route_stops
  alter column organization_id drop not null;

create or replace function public.route_stops_company_org_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  v_company_id := coalesce(new.company_id, new.organization_id);

  if v_company_id is null then
    select coalesce(r.company_id, r.organization_id, v.company_id, v.organization_id)
    into v_company_id
    from public.routes r
    left join public.visits v on v.id = new.visit_id
    where r.id = new.route_id;
  end if;

  new.company_id := coalesce(new.company_id, v_company_id);
  new.organization_id := coalesce(new.organization_id, v_company_id);
  return new;
end;
$$;

drop trigger if exists route_stops_company_org_sync_trigger
  on public.route_stops;

create trigger route_stops_company_org_sync_trigger
before insert or update on public.route_stops
for each row
execute function public.route_stops_company_org_sync();

-- The temporary pre-V2 Smart Route trigger is an implicit writer and must not
-- coexist with the transactional Route Stops V2 writer.
drop trigger if exists persist_employee_smart_route_order_trigger
  on public.employee_smart_route_state;
drop function if exists public.persist_employee_smart_route_order();

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
  v_has_property_id boolean := false;
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
  if v_company_id is null then
    raise exception 'Route company could not be resolved.';
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

  -- Compatibility projection for existing Admin/Employee readers. The large
  -- temporary offset prevents unique(route_id, route_order) collisions on
  -- databases where the constraint is not truly deferred.
  update public.visits v
  set route_order = 100000 + requested.position::integer
  from unnest(v_requested)
    with ordinality as requested(id, position)
  where v.route_id = p_route_id
    and v.id = requested.id;

  update public.visits v
  set route_order = requested.position::integer
  from unnest(v_requested)
    with ordinality as requested(id, position)
  where v.route_id = p_route_id
    and v.id = requested.id;

  update public.visits
  set route_order = null
  where route_id = p_route_id
    and status::text = 'cancelled';

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
