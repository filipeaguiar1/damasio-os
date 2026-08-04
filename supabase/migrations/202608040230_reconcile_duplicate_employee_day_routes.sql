begin;

-- Reconcile legacy duplicate Routes for the same Employee and service day.
-- The route whose canonical state changed most recently wins. This is normally
-- the Route that received Smart Route or Remove from today operations.

do $$
declare
  group_row record;
  target_route_id uuid;
  target_crew_id uuid;
  target_company_id uuid;
  next_version integer;
begin
  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'duplicate_route_repair', true);

  -- Remove empty duplicate route shells first. They have no operational value
  -- and can otherwise confuse Employee route resolution by crew/date.
  delete from public.routes empty_route
  where not exists (
    select 1 from public.visits v where v.route_id = empty_route.id
  )
  and exists (
    select 1
    from public.routes keeper
    where keeper.id <> empty_route.id
      and coalesce(keeper.company_id, keeper.organization_id)
          = coalesce(empty_route.company_id, empty_route.organization_id)
      and keeper.crew_id is not distinct from empty_route.crew_id
      and keeper.route_date = empty_route.route_date
      and keeper.created_at > empty_route.created_at
  );

  for group_row in
    select
      coalesce(v.company_id, v.organization_id) as company_id,
      v.assigned_employee_id as employee_id,
      v.scheduled_date,
      array_agg(distinct v.route_id) as route_ids
    from public.visits v
    where v.route_id is not null
      and v.assigned_employee_id is not null
      and v.scheduled_date is not null
      and v.status::text <> 'cancelled'
    group by
      coalesce(v.company_id, v.organization_id),
      v.assigned_employee_id,
      v.scheduled_date
    having count(distinct v.route_id) > 1
  loop
    target_company_id := group_row.company_id;

    select candidate.route_id
    into target_route_id
    from (
      select
        v.route_id,
        max(coalesce(state.updated_at, r.created_at)) as canonical_updated_at,
        max(coalesce(state.version, 0)) as canonical_version,
        count(*) as active_count,
        max(r.created_at) as route_created_at
      from public.visits v
      join public.routes r on r.id = v.route_id
      left join public.route_order_state state on state.route_id = v.route_id
      where v.route_id = any(group_row.route_ids)
        and v.assigned_employee_id = group_row.employee_id
        and v.scheduled_date = group_row.scheduled_date
        and v.status::text <> 'cancelled'
      group by v.route_id
    ) candidate
    order by
      candidate.canonical_updated_at desc nulls last,
      candidate.canonical_version desc,
      candidate.active_count desc,
      candidate.route_created_at desc,
      candidate.route_id
    limit 1;

    if target_route_id is null then
      continue;
    end if;

    select r.crew_id
    into target_crew_id
    from public.routes r
    where r.id = target_route_id;

    -- Retire duplicate Visit records for the same Job/Property/day. Prefer the
    -- record already on the winning Route, then the most recently updated one.
    with ranked as (
      select
        v.id,
        row_number() over (
          partition by coalesce(v.job_id::text, v.property_id::text, v.id::text)
          order by
            (v.route_id = target_route_id) desc,
            v.updated_at desc nulls last,
            v.created_at desc,
            v.id
        ) as duplicate_rank
      from public.visits v
      where v.route_id = any(group_row.route_ids)
        and v.assigned_employee_id = group_row.employee_id
        and v.scheduled_date = group_row.scheduled_date
        and v.status::text <> 'cancelled'
    ), duplicates as (
      select id from ranked where duplicate_rank > 1
    )
    delete from public.route_stops s
    using duplicates d
    where s.visit_id = d.id;

    with ranked as (
      select
        v.id,
        row_number() over (
          partition by coalesce(v.job_id::text, v.property_id::text, v.id::text)
          order by
            (v.route_id = target_route_id) desc,
            v.updated_at desc nulls last,
            v.created_at desc,
            v.id
        ) as duplicate_rank
      from public.visits v
      where v.route_id = any(group_row.route_ids)
        and v.assigned_employee_id = group_row.employee_id
        and v.scheduled_date = group_row.scheduled_date
        and v.status::text <> 'cancelled'
    )
    update public.visits v
    set status = 'cancelled',
        route_id = null,
        assigned_employee_id = null,
        crew_id = null,
        route_order = null,
        updated_at = now()
    from ranked
    where ranked.id = v.id
      and ranked.duplicate_rank > 1;

    -- Move every surviving Visit to the winning canonical Route.
    update public.visits v
    set route_id = target_route_id,
        crew_id = target_crew_id,
        route_order = null,
        updated_at = now()
    where v.route_id = any(group_row.route_ids)
      and v.assigned_employee_id = group_row.employee_id
      and v.scheduled_date = group_row.scheduled_date
      and v.status::text <> 'cancelled';

    -- Rebuild membership and order from the surviving Visits only.
    delete from public.route_stops
    where route_id = any(group_row.route_ids);

    insert into public.route_stops(
      company_id,
      route_id,
      visit_id,
      position,
      updated_at
    )
    select
      target_company_id,
      target_route_id,
      v.id,
      row_number() over (
        order by v.route_order nulls last, v.created_at, v.id
      )::integer,
      now()
    from public.visits v
    where v.route_id = target_route_id
      and v.assigned_employee_id = group_row.employee_id
      and v.scheduled_date = group_row.scheduled_date
      and v.status::text <> 'cancelled'
    on conflict (route_id, visit_id) do update set
      position = excluded.position,
      updated_at = excluded.updated_at;

    update public.visits v
    set route_order = s.position,
        updated_at = now()
    from public.route_stops s
    where s.route_id = target_route_id
      and s.visit_id = v.id
      and v.route_id = target_route_id;

    insert into public.route_order_state(
      route_id,
      company_id,
      version,
      last_source,
      updated_at
    ) values (
      target_route_id,
      target_company_id,
      1,
      'duplicate_route_repair',
      now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'duplicate_route_repair',
      updated_at = now()
    returning version into next_version;

    update public.employee_smart_route_state
    set applied_order = coalesce((
          select array_agg(s.visit_id order by s.position)
          from public.route_stops s
          where s.route_id = target_route_id
        ), '{}'::uuid[]),
        route_version = next_version,
        updated_at = now()
    where route_id = target_route_id;

    -- The losing Routes are now empty. Remove them so Employee/Admin cannot
    -- resolve a stale route for the same crew and date again.
    delete from public.routes r
    where r.id = any(group_row.route_ids)
      and r.id <> target_route_id
      and not exists (
        select 1 from public.visits v where v.route_id = r.id
      );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
