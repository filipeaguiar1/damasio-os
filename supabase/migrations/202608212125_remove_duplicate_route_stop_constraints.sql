begin;

-- Storage/IO hygiene only: preserve the canonical route model exactly as-is.
-- Production currently carries two equivalent UNIQUE constraints for each of
-- the canonical route-stop keys. Keep the newer route_id_* constraints and
-- remove only the legacy duplicates after proving the surviving definitions
-- are semantically identical.

do $$
declare
  v_keep_position text;
  v_drop_position text;
  v_keep_visit text;
  v_drop_visit text;
begin
  select pg_get_constraintdef(oid)
    into v_keep_position
  from pg_constraint
  where conrelid = 'public.route_stops'::regclass
    and conname = 'route_stops_route_id_position_key';

  select pg_get_constraintdef(oid)
    into v_drop_position
  from pg_constraint
  where conrelid = 'public.route_stops'::regclass
    and conname = 'route_stops_route_position_key';

  if v_drop_position is not null then
    if v_keep_position is null then
      raise exception 'Refusing route_stops cleanup: surviving route/position constraint is missing.';
    end if;
    if v_keep_position is distinct from v_drop_position then
      raise exception 'Refusing route_stops cleanup: route/position constraints are not identical (% vs %).',
        v_keep_position, v_drop_position;
    end if;
    alter table public.route_stops
      drop constraint route_stops_route_position_key;
  end if;

  select pg_get_constraintdef(oid)
    into v_keep_visit
  from pg_constraint
  where conrelid = 'public.route_stops'::regclass
    and conname = 'route_stops_route_id_visit_id_key';

  select pg_get_constraintdef(oid)
    into v_drop_visit
  from pg_constraint
  where conrelid = 'public.route_stops'::regclass
    and conname = 'route_stops_route_visit_key';

  if v_drop_visit is not null then
    if v_keep_visit is null then
      raise exception 'Refusing route_stops cleanup: surviving route/visit constraint is missing.';
    end if;
    if v_keep_visit is distinct from v_drop_visit then
      raise exception 'Refusing route_stops cleanup: route/visit constraints are not identical (% vs %).',
        v_keep_visit, v_drop_visit;
    end if;
    alter table public.route_stops
      drop constraint route_stops_route_visit_key;
  end if;
end
$$;

-- Guard the canonical invariants after cleanup. These checks do not rewrite
-- route data and intentionally fail the transaction if semantics changed.
do $$
begin
  if exists (
    select 1
    from public.route_stops
    group by route_id, position
    having count(*) > 1
  ) then
    raise exception 'Route-stop cleanup invariant failed: duplicate route positions exist.';
  end if;

  if exists (
    select 1
    from public.route_stops
    group by route_id, visit_id
    having count(*) > 1
  ) then
    raise exception 'Route-stop cleanup invariant failed: duplicate route visits exist.';
  end if;
end
$$;

commit;
