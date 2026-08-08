-- Remove the recursive route_stops -> visits synchronization triggers.
-- The canonical writer already updates visits.route_order after the complete
-- route_stops set has been written. Row-level synchronization during each stop
-- insert can activate legacy Visit triggers and recreate the same route stop,
-- violating route_stops_route_id_visit_id_key.

begin;

drop trigger if exists route_stops_sync_visit_order_insert on public.route_stops;
drop trigger if exists route_stops_sync_visit_order_update on public.route_stops;
drop trigger if exists route_stops_sync_visit_order_delete on public.route_stops;

drop function if exists public.sync_visit_route_order_from_stop_change();

-- Keep the helper for safe one-shot repair, but do not attach it to row-level
-- route_stops events.
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

  update public.visits v
  set route_order = null
  where v.route_id = p_route_id
    and not exists (
      select 1
      from public.route_stops s
      where s.route_id = p_route_id
        and s.visit_id = v.id
    );

  update public.visits v
  set route_order = s.position
  from public.route_stops s
  where s.route_id = p_route_id
    and s.visit_id = v.id
    and v.route_id = p_route_id
    and v.route_order is distinct from s.position;
end;
$$;

-- Repair current projections after removing the recursive triggers.
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
