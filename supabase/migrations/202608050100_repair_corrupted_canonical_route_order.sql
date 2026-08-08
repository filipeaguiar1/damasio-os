begin;

-- Recover only Routes whose durable order was overwritten after a successful
-- canonical transaction. The latest audit for the current route version is the
-- committed intent; this migration restores route_stops to that exact order.
-- It does not introduce a runtime fallback or an alternate order source.
do $$
declare
  candidate record;
  current_order uuid[];
  expected_order uuid[];
  stored_order uuid[];
  projected_order uuid[];
begin
  perform set_config('damasio.canonical_route_write', '1', true);

  for candidate in
    select
      state.route_id,
      state.company_id,
      state.version,
      audit.next_order
    from public.route_order_state state
    join lateral (
      select item.next_order
      from public.route_order_audit item
      where item.route_id = state.route_id
        and item.route_version = state.version
        and cardinality(item.next_order) > 0
      order by item.created_at desc, item.id desc
      limit 1
    ) audit on true
  loop
    expected_order := candidate.next_order;

    select coalesce(array_agg(stop.visit_id order by stop.position), '{}'::uuid[])
    into current_order
    from public.route_stops stop
    where stop.route_id = candidate.route_id;

    if current_order is not distinct from expected_order then
      continue;
    end if;

    -- Recovery is permitted only when both arrays contain exactly the same
    -- active Visit IDs. A legitimate membership change must not block repair
    -- of other Routes and must never be overwritten by this migration.
    if cardinality(current_order) <> cardinality(expected_order)
       or exists (
         select 1
         from unnest(current_order) current_visit(id)
         where not current_visit.id = any(expected_order)
       )
       or exists (
         select 1
         from unnest(expected_order) expected_visit(id)
         where not expected_visit.id = any(current_order)
       )
       or cardinality(expected_order) <> (
         select count(*)
         from public.visits visit
         where visit.route_id = candidate.route_id
           and visit.status::text <> 'cancelled'
       )
       or exists (
         select 1
         from public.visits visit
         where visit.route_id = candidate.route_id
           and visit.status::text <> 'cancelled'
           and not visit.id = any(expected_order)
       ) then
      raise notice
        'Skipping Canonical Route % because membership changed; no data was modified for this Route.',
        candidate.route_id;
      continue;
    end if;

    update public.route_stops
    set position = position + 1000000,
        updated_at = now()
    where route_id = candidate.route_id;

    update public.route_stops stop
    set position = expected.position::integer,
        updated_at = now()
    from unnest(expected_order) with ordinality expected(visit_id, position)
    where stop.route_id = candidate.route_id
      and stop.visit_id = expected.visit_id;

    -- Keep the legacy Visit field as a one-way projection of route_stops.
    perform public.sync_canonical_route_stops_v2(
      candidate.route_id,
      'canonical_corruption_repair'
    );

    select coalesce(array_agg(stop.visit_id order by stop.position), '{}'::uuid[])
    into stored_order
    from public.route_stops stop
    where stop.route_id = candidate.route_id;

    select coalesce(array_agg(visit.id order by visit.route_order), '{}'::uuid[])
    into projected_order
    from public.visits visit
    where visit.route_id = candidate.route_id
      and visit.status::text <> 'cancelled';

    if stored_order is distinct from expected_order
       or projected_order is distinct from expected_order then
      raise exception
        'Canonical Route % recovery verification failed.',
        candidate.route_id;
    end if;

    update public.route_order_state
    set last_source = 'canonical_corruption_repair',
        updated_at = now()
    where route_id = candidate.route_id
      and version = candidate.version;

    update public.employee_smart_route_state
    set applied_order = expected_order,
        route_version = candidate.version,
        updated_at = now()
    where route_id = candidate.route_id
      and route_version = candidate.version;

    insert into public.route_order_audit(
      company_id,
      route_id,
      source,
      previous_order,
      next_order,
      route_version
    ) values (
      candidate.company_id,
      candidate.route_id,
      'canonical_corruption_repair',
      current_order,
      expected_order,
      candidate.version
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
