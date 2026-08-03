-- Keep the legacy Admin route board aligned with the canonical route snapshot.
-- route_stops.position is the canonical order. visits.route_order is a derived
-- compatibility field still consumed by /api/admin/routes and must never drift.

begin;

create or replace function public.sync_visit_route_order_for_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_route_id is null then
    return;
  end if;

  -- Stops removed from the canonical route must not retain a stale order.
  update public.visits v
  set route_order = null
  where v.route_id = p_route_id
    and not exists (
      select 1
      from public.route_stops s
      where s.route_id = p_route_id
        and s.visit_id = v.id
    );

  -- The compatibility order used by Admin Web is derived only from the
  -- canonical route_stops array.
  update public.visits v
  set route_order = s.position
  from public.route_stops s
  where s.route_id = p_route_id
    and s.visit_id = v.id
    and v.route_id = p_route_id
    and v.route_order is distinct from s.position;
end;
$$;

create or replace function public.sync_visit_route_order_from_stop_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_visit_route_order_for_route(old.route_id);
    return old;
  end if;

  perform public.sync_visit_route_order_for_route(new.route_id);

  if tg_op = 'UPDATE' and old.route_id is distinct from new.route_id then
    perform public.sync_visit_route_order_for_route(old.route_id);
  end if;

  return new;
end;
$$;

drop trigger if exists route_stops_sync_visit_order_insert on public.route_stops;
drop trigger if exists route_stops_sync_visit_order_update on public.route_stops;
drop trigger if exists route_stops_sync_visit_order_delete on public.route_stops;

create trigger route_stops_sync_visit_order_insert
after insert on public.route_stops
for each row
execute function public.sync_visit_route_order_from_stop_change();

create trigger route_stops_sync_visit_order_update
after update of route_id, visit_id, position on public.route_stops
for each row
execute function public.sync_visit_route_order_from_stop_change();

create trigger route_stops_sync_visit_order_delete
after delete on public.route_stops
for each row
execute function public.sync_visit_route_order_from_stop_change();

-- Repair any route that drifted before this trigger existed.
do $$
declare
  v_route_id uuid;
begin
  for v_route_id in
    select distinct route_id
    from public.route_stops
    where route_id is not null
  loop
    perform public.sync_visit_route_order_for_route(v_route_id);
  end loop;
end;
$$;

commit;
