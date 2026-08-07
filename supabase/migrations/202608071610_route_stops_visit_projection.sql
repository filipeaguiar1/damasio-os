begin;

-- route_stops remains the single durable source of route membership and order.
-- This trigger is intentionally one-way: route_stops -> visits.route_order.
-- A later Smart Route writer migration stopped calling the existing projection
-- RPC, which could leave the compatibility column stale after a successful
-- canonical apply. Project each stop mutation in the same transaction without
-- ever writing back to route_stops from Visits.

create or replace function public.project_route_stop_to_visit_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.visits v
    set route_order = null,
        updated_at = now()
    where v.id = old.visit_id
      and v.route_id = old.route_id
      and not exists (
        select 1
        from public.route_stops s
        where s.route_id = old.route_id
          and s.visit_id = old.visit_id
      );
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.visit_id is distinct from new.visit_id
          or old.route_id is distinct from new.route_id) then
    update public.visits v
    set route_order = null,
        updated_at = now()
    where v.id = old.visit_id
      and v.route_id = old.route_id
      and not exists (
        select 1
        from public.route_stops s
        where s.route_id = old.route_id
          and s.visit_id = old.visit_id
      );
  end if;

  update public.visits v
  set route_order = new.position,
      updated_at = now()
  where v.id = new.visit_id
    and v.route_id = new.route_id
    and v.route_order is distinct from new.position;

  return new;
end;
$$;

drop trigger if exists project_route_stop_to_visit_order_trigger
  on public.route_stops;

create trigger project_route_stop_to_visit_order_trigger
after insert or update of route_id, visit_id, position or delete
on public.route_stops
for each row
execute function public.project_route_stop_to_visit_order();

-- Repair any projection drift already present when this migration is applied.
update public.visits v
set route_order = s.position,
    updated_at = now()
from public.route_stops s
where s.visit_id = v.id
  and s.route_id = v.route_id
  and v.route_order is distinct from s.position;

update public.visits v
set route_order = null,
    updated_at = now()
where v.route_id is not null
  and v.status::text <> 'cancelled'
  and not exists (
    select 1
    from public.route_stops s
    where s.route_id = v.route_id
      and s.visit_id = v.id
  );

notify pgrst, 'reload schema';

commit;
