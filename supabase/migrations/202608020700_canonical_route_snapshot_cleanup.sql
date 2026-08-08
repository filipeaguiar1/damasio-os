-- Canonical Route Snapshot hardening
-- Removes the retired 55 York demo chain, invalidates legacy geometry caches,
-- and guarantees that route version changes are available to every client.

begin;

create temp table retired_55_york_demo on commit drop as
select distinct
  c.id as customer_id,
  p.id as property_id
from public.customers c
join public.properties p on p.customer_id = c.id
where lower(regexp_replace(trim(coalesce(p.address_line1, '')), '[.]', '', 'g'))
      in ('55 york blvd', '55 york boulevard')
  and (
    coalesce(c.full_name, '') ~* '^demo customer\b'
    or coalesce(c.email, '') ~* '@4everseasons[.]test$'
    or coalesce(c.notes, '') ~* '\[TEMP_DEMO_SANDBOX_V1\]'
  );

create temp table retired_55_york_jobs on commit drop as
select distinct j.id as job_id
from public.jobs j
join retired_55_york_demo d
  on j.customer_id = d.customer_id
  or j.property_id = d.property_id;

create temp table retired_55_york_visits on commit drop as
select distinct v.id as visit_id, v.route_id
from public.visits v
where v.customer_id in (select customer_id from retired_55_york_demo)
   or v.property_id in (select property_id from retired_55_york_demo)
   or v.job_id in (select job_id from retired_55_york_jobs);

create temp table retired_55_york_routes on commit drop as
select distinct route_id
from retired_55_york_visits
where route_id is not null;

delete from public.route_stops s
where s.visit_id in (select visit_id from retired_55_york_visits);

delete from public.visits v
where v.id in (select visit_id from retired_55_york_visits);

delete from public.jobs j
where j.id in (select job_id from retired_55_york_jobs);

delete from public.properties p
where p.id in (select property_id from retired_55_york_demo);

delete from public.customers c
where c.id in (select customer_id from retired_55_york_demo);

-- Reindex each affected canonical route without inventing a second order.
do $$
declare
  v_route_id uuid;
  v_company_id uuid;
  v_version integer;
  v_order uuid[];
begin
  for v_route_id in select route_id from retired_55_york_routes loop
    update public.route_stops
    set position = position + 100000,
        updated_at = now()
    where route_id = v_route_id;

    with ranked as (
      select visit_id, row_number() over (order by position, visit_id)::integer as next_position
      from public.route_stops
      where route_id = v_route_id
    )
    update public.route_stops s
    set position = ranked.next_position,
        updated_at = now()
    from ranked
    where s.route_id = v_route_id
      and s.visit_id = ranked.visit_id;

    update public.visits
    set route_order = null
    where route_id = v_route_id;

    update public.visits v
    set route_order = s.position
    from public.route_stops s
    where s.route_id = v_route_id
      and s.visit_id = v.id
      and v.route_id = v_route_id;

    select coalesce(r.company_id, r.organization_id)
    into v_company_id
    from public.routes r
    where r.id = v_route_id;

    insert into public.route_order_state(
      route_id,
      company_id,
      version,
      last_source,
      updated_at
    ) values (
      v_route_id,
      v_company_id,
      2,
      'retired_55_york_cleanup',
      now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'retired_55_york_cleanup',
      updated_at = now()
    returning version into v_version;

    select coalesce(array_agg(s.visit_id order by s.position), '{}'::uuid[])
    into v_order
    from public.route_stops s
    where s.route_id = v_route_id;

    update public.employee_smart_route_state
    set applied_order = v_order,
        original_order = v_order,
        active = false,
        route_version = v_version,
        restored_at = now(),
        updated_at = now()
    where route_id = v_route_id;
  end loop;
end;
$$;

-- Derived caches are disposable. They must never survive a canonical reset.
do $$
begin
  if to_regclass('public.route_map_cache') is not null then
    execute 'delete from public.route_map_cache';
  end if;
  if to_regclass('public.route_map_rebuild_queue') is not null then
    execute 'delete from public.route_map_rebuild_queue';
  end if;
end;
$$;

alter table public.route_order_state replica identity full;
alter table public.route_stops replica identity full;
alter table public.visits replica identity full;
alter table public.employee_smart_route_state replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.route_order_state;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.route_stops;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.visits;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.employee_smart_route_state;
  exception when duplicate_object then null;
  end;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.customers c
    join public.properties p on p.customer_id = c.id
    where lower(regexp_replace(trim(coalesce(p.address_line1, '')), '[.]', '', 'g'))
          in ('55 york blvd', '55 york boulevard')
      and (
        coalesce(c.full_name, '') ~* '^demo customer\b'
        or coalesce(c.email, '') ~* '@4everseasons[.]test$'
        or coalesce(c.notes, '') ~* '\[TEMP_DEMO_SANDBOX_V1\]'
      )
  ) then
    raise exception 'Retired 55 York demo data still exists.';
  end if;
end;
$$;

commit;
