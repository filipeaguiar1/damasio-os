-- V52.9 Employee Smart Route Database Mode
-- Persists employee-applied route changes per tenant and restores the original
-- Admin order without losing newly assigned visits.

alter table if exists public.activity_log
  add column if not exists company_id uuid references public.organizations(id) on delete cascade;

alter table if exists public.activity_log
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.profiles
    where id=auth.uid() and role::text='master' and active
  )
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(company_id,organization_id)
  from public.profiles
  where id=auth.uid() and active
  limit 1
$$;

create or replace function public.master_has_company_access(p_company_id uuid, p_required_level text default 'read_only')
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_allowed boolean := false;
begin
  if not public.is_master() then return false; end if;
  if p_company_id=public.current_company_id() then return true; end if;
  if to_regclass('public.master_company_access_requests') is null then return false; end if;

  execute $q$
    select exists(
      select 1
      from public.master_company_access_requests r
      where r.master_profile_id=auth.uid()
        and r.company_id=$1
        and r.approved_at is not null
        and r.revoked_at is null
        and coalesce(r.session_expires_at,r.code_expires_at)>now()
        and case $2
          when 'read_only' then r.access_level in ('read_only','operational_support','full_temporary')
          when 'operational_support' then r.access_level in ('operational_support','full_temporary')
          when 'full_temporary' then r.access_level='full_temporary'
          else false
        end
    )
  $q$ into v_allowed using p_company_id,p_required_level;

  return coalesce(v_allowed,false);
end;
$$;

create table if not exists public.employee_smart_route_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  crew_id uuid references public.crews(id) on delete set null,
  route_date date not null,
  original_order uuid[] not null default '{}',
  applied_order uuid[] not null default '{}',
  origin_label text not null default '',
  origin_latitude double precision,
  origin_longitude double precision,
  active boolean not null default true,
  applied_by_profile_id uuid references public.profiles(id) on delete set null,
  applied_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by_profile_id uuid references public.profiles(id) on delete set null,
  route_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(route_id)
);

create or replace function public.database_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_names text[] := array[
    'organizations','profiles','customers','employees','crews','properties',
    'service_requests','quotes','invoices','payments','jobs','routes','visits',
    'tasks','photos','feedback','activity_log','employee_smart_route_state'
  ];
  check_table_name text;
  table_exists boolean;
  row_count integer;
  checks jsonb := '[]'::jsonb;
begin
  foreach check_table_name in array table_names loop
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = check_table_name
    ) into table_exists;

    if table_exists then
      execute format('select count(*) from public.%I', check_table_name) into row_count;
      checks := checks || jsonb_build_object(
        'table', check_table_name,
        'exists', true,
        'visible_rows', row_count,
        'error', null
      );
    else
      checks := checks || jsonb_build_object(
        'table', check_table_name,
        'exists', false,
        'visible_rows', null,
        'error', 'Table not found'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'tables', checks
  );
end;
$$;

grant execute on function public.database_health_check() to anon, authenticated;

create index if not exists employee_smart_route_state_company_route_idx
  on public.employee_smart_route_state(company_id, route_date desc, active);

alter table public.employee_smart_route_state enable row level security;

drop policy if exists employee_smart_route_state_company_read on public.employee_smart_route_state;
create policy employee_smart_route_state_company_read on public.employee_smart_route_state
for select to authenticated
using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'));

create or replace function public.employee_can_use_route(p_route_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.routes r
    left join public.employees e
      on e.profile_id=auth.uid()
      and e.active
      and coalesce(e.company_id,e.organization_id)=coalesce(r.company_id,r.organization_id)
    where r.id=p_route_id
      and coalesce(r.company_id,r.organization_id)=public.current_company_id()
      and (
        exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role::text in ('admin','manager','master'))
        or r.crew_id=e.crew_id
        or exists (
          select 1 from public.visits v
          where v.route_id=r.id
            and v.assigned_employee_id=e.id
        )
      )
  );
$$;

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
set search_path=public
as $$
begin
  if not public.employee_can_use_route(p_route_id) then
    raise exception 'You do not have access to this route.';
  end if;

  return query
  select s.route_id,s.crew_id,s.route_date,s.original_order,s.applied_order,
         s.origin_label,s.origin_latitude,s.origin_longitude,s.applied_at,s.active,s.route_version
  from public.employee_smart_route_state s
  where s.route_id=p_route_id and s.active;
end;
$$;

create or replace function public.apply_employee_smart_route(
  p_route_id uuid,
  p_original_order uuid[],
  p_applied_order uuid[],
  p_origin_label text,
  p_origin_latitude double precision,
  p_origin_longitude double precision,
  p_expected_version integer default null
) returns table(route_version integer)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_route public.routes%rowtype;
  v_existing public.employee_smart_route_state%rowtype;
  v_allowed uuid[];
  v_original uuid[];
  v_applied uuid[];
  v_final uuid[];
  v_id uuid;
  v_has_existing boolean := false;
  v_index integer := 1;
begin
  select * into v_route from public.routes where id=p_route_id for update;
  if not found then raise exception 'Route not found.'; end if;
  if not public.employee_can_use_route(p_route_id) then raise exception 'You do not have access to this route.'; end if;

  select array_agg(v.id order by v.route_order nulls last, v.id)
    into v_allowed
  from public.visits v
  where v.route_id=p_route_id
    and coalesce(v.company_id,v.organization_id)=coalesce(v_route.company_id,v_route.organization_id)
    and v.status not in ('cancelled','missed');

  v_allowed := coalesce(v_allowed,'{}'::uuid[]);
  if cardinality(v_allowed)=0 then raise exception 'This route has no active visits.'; end if;

  select * into v_existing from public.employee_smart_route_state where route_id=p_route_id for update;
  v_has_existing := found;
  if v_has_existing and v_existing.active and p_expected_version is not null and v_existing.route_version<>p_expected_version then
    raise exception 'Route changed on another device. Refresh before applying Smart Route.';
  end if;

  select coalesce(array_agg(distinct_id order by first_seen),'{}'::uuid[]) into v_original
  from (
    select distinct on (id) id as distinct_id, first_seen
    from unnest(coalesce(p_original_order,'{}'::uuid[])) with ordinality as input(id,first_seen)
    where id=any(v_allowed)
    order by id, first_seen
  ) dedup;
  v_original := v_original || array(select id from unnest(v_allowed) id where not id=any(v_original));

  select coalesce(array_agg(distinct_id order by first_seen),'{}'::uuid[]) into v_applied
  from (
    select distinct on (id) id as distinct_id, first_seen
    from unnest(coalesce(p_applied_order,'{}'::uuid[])) with ordinality as input(id,first_seen)
    where id=any(v_allowed)
    order by id, first_seen
  ) dedup;
  v_final := v_applied || array(select id from unnest(v_original) id where not id=any(v_applied));

  foreach v_id in array v_final loop
    update public.visits
    set route_order=v_index
    where id=v_id and route_id=p_route_id;
    v_index := v_index + 1;
  end loop;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details,metadata)
  values(
    coalesce(v_route.company_id,v_route.organization_id),
    coalesce(v_route.company_id,v_route.organization_id),
    auth.uid(),
    'employee_smart_route.applied',
    'routes',
    p_route_id,
    'Employee Smart Route applied from mobile app.',
    jsonb_build_object(
      'route_id',p_route_id,
      'route_date',v_route.route_date,
      'crew_id',v_route.crew_id,
      'origin_label',coalesce(p_origin_label,''),
      'stops',cardinality(v_final)
    )
  );

  insert into public.employee_smart_route_state(
    company_id,route_id,crew_id,route_date,original_order,applied_order,
    origin_label,origin_latitude,origin_longitude,active,applied_by_profile_id,applied_at,route_version,updated_at
  )
  values(
    coalesce(v_route.company_id,v_route.organization_id),p_route_id,v_route.crew_id,v_route.route_date,
    case when v_has_existing and v_existing.active then v_existing.original_order else v_original end,
    v_final,coalesce(p_origin_label,''),p_origin_latitude,p_origin_longitude,true,auth.uid(),now(),
    coalesce(v_existing.route_version,0)+1,now()
  )
  on conflict(route_id) do update set
    original_order=case when employee_smart_route_state.active then employee_smart_route_state.original_order else excluded.original_order end,
    applied_order=excluded.applied_order,
    origin_label=excluded.origin_label,
    origin_latitude=excluded.origin_latitude,
    origin_longitude=excluded.origin_longitude,
    active=true,
    applied_by_profile_id=auth.uid(),
    applied_at=now(),
    restored_at=null,
    restored_by_profile_id=null,
    route_version=employee_smart_route_state.route_version+1,
    updated_at=now()
  returning employee_smart_route_state.route_version into route_version;

  perform public.queue_route_map_rebuild(p_route_id,coalesce(v_route.company_id,v_route.organization_id),'employee_smart_route_applied');
  return next;
end;
$$;

create or replace function public.restore_employee_smart_route(
  p_route_id uuid,
  p_expected_version integer default null
) returns table(restored boolean, route_version integer)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_route public.routes%rowtype;
  v_state public.employee_smart_route_state%rowtype;
  v_current uuid[];
  v_restored uuid[];
  v_id uuid;
  v_index integer := 1;
begin
  select * into v_route from public.routes where id=p_route_id for update;
  if not found then raise exception 'Route not found.'; end if;
  if not public.employee_can_use_route(p_route_id) then raise exception 'You do not have access to this route.'; end if;

  select * into v_state from public.employee_smart_route_state where route_id=p_route_id and active for update;
  if not found then
    restored := false;
    route_version := null;
    return next;
    return;
  end if;
  if p_expected_version is not null and v_state.route_version<>p_expected_version then
    raise exception 'Route changed on another device. Refresh before restoring.';
  end if;

  select array_agg(v.id order by v.route_order nulls last, v.id) into v_current
  from public.visits v
  where v.route_id=p_route_id
    and coalesce(v.company_id,v.organization_id)=coalesce(v_route.company_id,v_route.organization_id)
    and v.status not in ('cancelled','missed');

  v_current := coalesce(v_current,'{}'::uuid[]);
  v_restored := array(select id from unnest(v_state.original_order) id where id=any(v_current));
  v_restored := v_restored || array(select id from unnest(v_current) id where not id=any(v_restored));

  foreach v_id in array v_restored loop
    update public.visits set route_order=v_index where id=v_id and route_id=p_route_id;
    v_index := v_index + 1;
  end loop;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details,metadata)
  values(
    coalesce(v_route.company_id,v_route.organization_id),
    coalesce(v_route.company_id,v_route.organization_id),
    auth.uid(),
    'employee_smart_route.restored',
    'routes',
    p_route_id,
    'Employee Smart Route restored to original Admin order.',
    jsonb_build_object(
      'route_id',p_route_id,
      'route_date',v_route.route_date,
      'crew_id',v_route.crew_id,
      'stops',cardinality(v_restored)
    )
  );

  update public.employee_smart_route_state
  set active=false,restored_at=now(),restored_by_profile_id=auth.uid(),route_version=employee_smart_route_state.route_version+1,updated_at=now()
  where id=v_state.id
  returning employee_smart_route_state.route_version into route_version;

  perform public.queue_route_map_rebuild(p_route_id,coalesce(v_route.company_id,v_route.organization_id),'employee_smart_route_restored');
  restored := true;
  return next;
end;
$$;
