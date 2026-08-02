begin;

-- Finish the rollout with every existing Route synchronized. This compacts
-- legacy gaps, clears cancelled positions, creates versions/audit rows and
-- ensures Admin/Employee readers start from identical data immediately.
do $$
declare
  v_route_id uuid;
  v_result jsonb;
begin
  for v_route_id in
    select distinct route_id
    from public.visits
    where route_id is not null
    order by route_id
  loop
    v_result := public.sync_canonical_route_stops_v2(
      v_route_id,
      'canonical_route_stops_v2_rollout'
    );

    if not coalesce((v_result ->> 'saved')::boolean, false) then
      raise exception 'Route % was not confirmed during V2 rollout.', v_route_id;
    end if;
  end loop;
end
$$;

-- Global invariants. Any failure rolls the complete migration back.
do $$
begin
  if exists (
    select 1
    from public.route_stops
    group by route_id, position
    having count(*) > 1
  ) then
    raise exception 'Duplicate Route Stop positions remain after V2 rollout.';
  end if;

  if exists (
    select 1
    from public.route_stops
    group by visit_id
    having count(*) > 1
  ) then
    raise exception 'A Visit belongs to more than one Route after V2 rollout.';
  end if;

  if exists (
    select 1
    from public.visits v
    where v.route_id is not null
      and v.status::text <> 'cancelled'
      and not exists (
        select 1
        from public.route_stops s
        where s.route_id = v.route_id
          and s.visit_id = v.id
          and s.position = v.route_order
      )
  ) then
    raise exception 'A non-cancelled Visit is missing its matching Route Stop.';
  end if;

  if exists (
    select 1
    from public.route_stops s
    left join public.visits v on v.id = s.visit_id
    where v.id is null
       or v.route_id is distinct from s.route_id
       or v.status::text = 'cancelled'
       or v.route_order is distinct from s.position
  ) then
    raise exception 'A Route Stop does not match its Visit projection.';
  end if;

  if exists (
    select 1
    from public.visits v
    where v.route_id is not null
      and v.status::text = 'cancelled'
      and v.route_order is not null
  ) then
    raise exception 'A cancelled Visit still occupies a Route position.';
  end if;

  if exists (
    select 1
    from public.routes r
    where exists (
      select 1 from public.visits v where v.route_id = r.id
    )
    and not exists (
      select 1 from public.route_order_state state where state.route_id = r.id
    )
  ) then
    raise exception 'A populated Route is missing its canonical version state.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
