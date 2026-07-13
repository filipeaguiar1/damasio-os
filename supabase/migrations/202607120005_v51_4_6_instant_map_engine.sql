-- V51.4.6 Instant Map Engine
-- Canonical property coordinates remain on properties. Route geometry is a derived,
-- rebuildable cache keyed by the canonical route and company.

alter table public.properties add column if not exists geocoded_at timestamptz;
alter table public.properties add column if not exists geocode_provider text;
alter table public.properties add column if not exists geocode_status text not null default 'not_mapped'
  check (geocode_status in ('not_mapped','mapped','failed','needs_review'));

create table if not exists public.route_map_cache (
  route_id uuid primary key references public.routes(id) on delete cascade,
  company_id uuid not null references public.organizations(id) on delete cascade,
  geometry jsonb,
  bounds jsonb,
  distance_meters double precision,
  duration_seconds double precision,
  points_hash text not null default '',
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  provider text,
  error_message text,
  rebuilt_at timestamptz,
  updated_at timestamptz not null default now(),
  check (geometry is null or geometry->>'type' = 'LineString')
);

create index if not exists route_map_cache_company_updated_idx
  on public.route_map_cache(company_id, updated_at desc);

create table if not exists public.route_map_rebuild_queue (
  route_id uuid primary key references public.routes(id) on delete cascade,
  company_id uuid not null references public.organizations(id) on delete cascade,
  reason text not null,
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text
);

create index if not exists route_map_rebuild_queue_requested_idx
  on public.route_map_rebuild_queue(requested_at) where locked_at is null;

create or replace function public.claim_route_map_rebuilds(p_limit integer default 10)
returns table(route_id uuid,company_id uuid,attempts integer)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with claimed as (
    select q.route_id from public.route_map_rebuild_queue q
    where q.locked_at is null and q.requested_at<=now()
    order by q.requested_at
    for update skip locked
    limit greatest(1,least(p_limit,25))
  )
  update public.route_map_rebuild_queue q
  set locked_at=now()
  from claimed
  where q.route_id=claimed.route_id
  returning q.route_id,q.company_id,q.attempts;
end;
$$;

create or replace function public.queue_route_map_rebuild(
  p_route_id uuid,
  p_company_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_route_id is null or p_company_id is null then return; end if;
  insert into public.route_map_rebuild_queue(route_id,company_id,reason,requested_at,locked_at,last_error)
  values(p_route_id,p_company_id,p_reason,now(),null,null)
  on conflict(route_id) do update set
    company_id=excluded.company_id,
    reason=excluded.reason,
    requested_at=excluded.requested_at,
    locked_at=null,
    last_error=null;

  insert into public.route_map_cache(route_id,company_id,status,updated_at)
  values(p_route_id,p_company_id,'pending',now())
  on conflict(route_id) do update set status='pending',updated_at=now(),error_message=null;
end;
$$;

create or replace function public.route_map_visit_changed() returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old_route uuid := case when tg_op='INSERT' then null else old.route_id end;
  v_new_route uuid := case when tg_op='DELETE' then null else new.route_id end;
  v_old_company uuid := case when tg_op='INSERT' then null else coalesce(old.company_id,old.organization_id) end;
  v_new_company uuid := case when tg_op='DELETE' then null else coalesce(new.company_id,new.organization_id) end;
begin
  perform public.queue_route_map_rebuild(v_old_route,v_old_company,'visit_changed');
  if v_new_route is distinct from v_old_route or tg_op='UPDATE' then
    perform public.queue_route_map_rebuild(v_new_route,v_new_company,'visit_changed');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_visits_route_map_rebuild on public.visits;
create trigger trg_visits_route_map_rebuild
after insert or delete or update of route_id,route_order,property_id,crew_id,assigned_employee_id,status
on public.visits for each row execute function public.route_map_visit_changed();

create or replace function public.route_map_property_changed() returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare r record;
begin
  for r in
    select distinct v.route_id,coalesce(v.company_id,v.organization_id) company_id
    from public.visits v where v.property_id=new.id and v.route_id is not null
  loop
    perform public.queue_route_map_rebuild(r.route_id,r.company_id,'property_changed');
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_properties_route_map_rebuild on public.properties;
create trigger trg_properties_route_map_rebuild
after update of latitude,longitude,address_line1,city,province,postal_code,country
on public.properties for each row execute function public.route_map_property_changed();

create or replace function public.route_map_employee_changed() returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare r record;
begin
  for r in
    select distinct v.route_id,coalesce(v.company_id,v.organization_id) company_id
    from public.visits v
    where v.route_id is not null and (v.assigned_employee_id=new.id or v.crew_id=new.crew_id)
  loop
    perform public.queue_route_map_rebuild(r.route_id,r.company_id,'employee_changed');
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_employees_route_map_rebuild on public.employees;
create trigger trg_employees_route_map_rebuild
after update of crew_id,active on public.employees for each row
execute function public.route_map_employee_changed();

create or replace function public.route_map_route_changed() returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.queue_route_map_rebuild(new.id,coalesce(new.company_id,new.organization_id),'route_or_dispatch_changed');
  return new;
end;
$$;

drop trigger if exists trg_routes_route_map_rebuild on public.routes;
create trigger trg_routes_route_map_rebuild
after insert or update of crew_id,route_date,status on public.routes for each row
execute function public.route_map_route_changed();

alter table public.route_map_cache enable row level security;
alter table public.route_map_rebuild_queue enable row level security;

drop policy if exists route_map_cache_company_read on public.route_map_cache;
create policy route_map_cache_company_read on public.route_map_cache for select to authenticated
using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'));

drop policy if exists route_map_queue_company_read on public.route_map_rebuild_queue;
create policy route_map_queue_company_read on public.route_map_rebuild_queue for select to authenticated
using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'));

-- Existing routes are rebuilt asynchronously after deployment.
insert into public.route_map_rebuild_queue(route_id,company_id,reason)
select r.id,coalesce(r.company_id,r.organization_id),'migration_backfill'
from public.routes r where coalesce(r.company_id,r.organization_id) is not null
on conflict(route_id) do update set requested_at=now(),locked_at=null,reason='migration_backfill';
