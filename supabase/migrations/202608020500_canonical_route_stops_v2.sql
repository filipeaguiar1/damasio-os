begin;

-- Canonical Route Stops V2
-- route_stops is the durable source of truth for route membership and order.
-- visits.route_order is maintained only as a compatibility projection inside
-- the same transaction so existing Admin/Employee readers cannot diverge.

create table if not exists public.route_stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete restrict,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, visit_id),
  unique (route_id, position)
);

create index if not exists route_stops_company_route_idx
  on public.route_stops(company_id, route_id, position);
create index if not exists route_stops_visit_idx
  on public.route_stops(visit_id);

create table if not exists public.route_order_state (
  route_id uuid primary key references public.routes(id) on delete cascade,
  company_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  last_source text not null default 'migration',
  last_actor_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists route_order_state_company_idx
  on public.route_order_state(company_id, updated_at desc);

create table if not exists public.route_order_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  source text not null,
  previous_order uuid[] not null default '{}'::uuid[],
  next_order uuid[] not null default '{}'::uuid[],
  route_version integer not null,
  created_at timestamptz not null default now()
);

create index if not exists route_order_audit_route_idx
  on public.route_order_audit(route_id, created_at desc);
create index if not exists route_order_audit_company_idx
  on public.route_order_audit(company_id, created_at desc);

alter table public.route_stops enable row level security;
alter table public.route_order_state enable row level security;
alter table public.route_order_audit enable row level security;

grant select on public.route_stops to authenticated;
grant select on public.route_order_state to authenticated;
grant select on public.route_order_audit to authenticated;
grant all on public.route_stops to service_role;
grant all on public.route_order_state to service_role;
grant all on public.route_order_audit to service_role;

drop policy if exists route_stops_company_read on public.route_stops;
create policy route_stops_company_read
on public.route_stops
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

drop policy if exists route_order_state_company_read on public.route_order_state;
create policy route_order_state_company_read
on public.route_order_state
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

drop policy if exists route_order_audit_company_read on public.route_order_audit;
create policy route_order_audit_company_read
on public.route_order_audit
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

-- Remove the temporary trigger-based writer. Route order may only be changed by
-- an explicit transaction, never as a side effect of an unrelated upsert.
drop trigger if exists persist_employee_smart_route_order_trigger
  on public.employee_smart_route_state;
drop function if exists public.persist_employee_smart_route_order();

-- Backfill every existing published route without deleting or recreating Visits.
insert into public.route_stops(company_id, route_id, visit_id, position)
select
  coalesce(v.company_id, v.organization_id),
  v.route_id,
  v.id,
  row_number() over (
    partition by v.route_id
    order by v.route_order nulls last, v.created_at, v.id
  )::integer
from public.visits v
where v.route_id is not null
  and v.status::text <> 'cancelled'
on conflict (route_id, visit_id) do nothing;

insert into public.route_order_state(
  route_id,
  company_id,
  version,
  last_source,
  updated_at
)
select
  s.route_id,
  min(s.company_id::text)::uuid,
  1,
  'migration_backfill',
  now()
from public.route_stops s
group by s.route_id
on conflict (route_id) do nothing;

create or replace function public.get_canonical_route_order_v2(p_route_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_company_id uuid;
  v_version integer;
  v_order uuid[];
begin
  select *
  into v_route
  from public.routes
  where id = p_route_id;

  if not found then
    raise exception 'Route not found.';
  end if;

  v_company_id := coalesce(v_route.company_id, v_route.organization_id);

  if not (
    v_company_id = public.current_company_id()
    or public.master_has_company_access(v_company_id, 'read_only')
  ) then
    raise exception 'You do not have access to this route.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_order
  from public.route_stops s
  where s.route_id = p_route_id;

  select coalesce(state.version, 1)
  into v_version
  from public.route_order_state state
  where state.route_id = p_route_id;

  return jsonb_build_object(
    'routeId', p_route_id,
    'version', coalesce(v_version, 1),
    'orderedVisitIds', v_order
  );
end;
$$;

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
  v_allowed uuid[] := '{}'::uuid[];
  v_requested uuid[] := '{}'::uuid[];
  v_previous uuid[] := '{}'::uuid[];
  v_projected uuid[] := '{}'::uuid[];
  v_stored uuid[] := '{}'::uuid[];
  v_version integer := 0;
  v_next_version integer;
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
    and v.status::text not in ('cancelled', 'missed');

  if cardinality(v_allowed) = 0 then
    raise exception 'This route has no active houses.';
  end if;

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
    raise exception 'The reviewed route must contain every active house exactly once.';
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
  into v_version
  from public.route_order_state state
  where state.route_id = p_route_id
  for update;

  if p_expected_version is not null
     and v_version is distinct from p_expected_version then
    raise exception 'Route changed on another device. Refresh and review it again.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
  into v_previous
  from public.route_stops s
  where s.route_id = p_route_id;

  if cardinality(v_previous) = 0 then
    v_previous := v_allowed;
  end if;

  -- All writes below are in this single database transaction.
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

  -- Compatibility projection for existing Admin/Employee queries.
  update public.visits
  set route_order = null
  where route_id = p_route_id
    and id = any(v_requested);

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

  -- Compatibility state remains readable by older clients but is no longer a writer.
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
    and v.id = any(v_requested);

  if v_stored is distinct from v_requested
     or v_projected is distinct from v_requested then
    raise exception 'Route verification failed. Nothing was changed.';
  end if;

  begin
    perform public.queue_route_map_rebuild(
      p_route_id,
      v_company_id,
      'canonical_route_order_v2'
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
    'appliedOrder', v_requested
  );
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

  v_result := public.apply_canonical_route_order_v2(
    p_route_id,
    v_state.original_order,
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

-- Preserve the existing public RPC contracts while routing every write through V2.
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
    'employee_smart_route'
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

grant execute on function public.get_canonical_route_order_v2(uuid)
  to authenticated;
grant execute on function public.apply_canonical_route_order_v2(
  uuid, uuid[], text, double precision, double precision, integer, text
) to authenticated;
grant execute on function public.restore_canonical_route_order_v2(uuid, integer)
  to authenticated;
grant execute on function public.apply_employee_smart_route(
  uuid, uuid[], uuid[], text, double precision, double precision, integer
) to authenticated;
grant execute on function public.restore_employee_smart_route(uuid, integer)
  to authenticated;

commit;
