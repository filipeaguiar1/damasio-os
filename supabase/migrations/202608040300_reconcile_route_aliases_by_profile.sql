begin;

-- Reconcile duplicate Routes created for legacy Employee aliases that share the
-- same authenticated profile. The route whose canonical state changed most
-- recently is authoritative. Older alias Routes are retired instead of being
-- merged, so houses already removed from today cannot reappear.

do $$
declare
  group_row record;
  target_route_id uuid;
  target_company_id uuid;
  target_employee_id uuid;
  target_crew_id uuid;
  target_version integer;
begin
  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'employee_alias_route_repair', true);

  for group_row in
    select
      e.profile_id,
      coalesce(v.company_id, v.organization_id) as company_id,
      v.scheduled_date,
      array_agg(distinct v.route_id) as route_ids
    from public.visits v
    join public.employees e on e.id = v.assigned_employee_id
    where v.route_id is not null
      and v.assigned_employee_id is not null
      and e.profile_id is not null
      and v.scheduled_date is not null
      and v.status::text <> 'cancelled'
    group by
      e.profile_id,
      coalesce(v.company_id, v.organization_id),
      v.scheduled_date
    having count(distinct v.route_id) > 1
  loop
    target_company_id := group_row.company_id;

    select candidate.route_id
    into target_route_id
    from (
      select
        v.route_id,
        max(coalesce(state.updated_at, smart.updated_at, r.created_at)) as changed_at,
        max(coalesce(state.version, smart.route_version, 0)) as route_version,
        count(*) as active_count,
        max(r.created_at) as route_created_at
      from public.visits v
      join public.employees e on e.id = v.assigned_employee_id
      join public.routes r on r.id = v.route_id
      left join public.route_order_state state on state.route_id = v.route_id
      left join public.employee_smart_route_state smart on smart.route_id = v.route_id
      where e.profile_id = group_row.profile_id
        and coalesce(v.company_id, v.organization_id) = group_row.company_id
        and v.scheduled_date = group_row.scheduled_date
        and v.route_id = any(group_row.route_ids)
        and v.status::text <> 'cancelled'
      group by v.route_id
    ) candidate
    order by
      candidate.changed_at desc nulls last,
      candidate.route_version desc,
      candidate.active_count asc,
      candidate.route_created_at desc,
      candidate.route_id
    limit 1;

    if target_route_id is null then
      continue;
    end if;

    select
      v.assigned_employee_id,
      coalesce(v.crew_id, r.crew_id)
    into target_employee_id, target_crew_id
    from public.visits v
    join public.employees e on e.id = v.assigned_employee_id
    join public.routes r on r.id = v.route_id
    where v.route_id = target_route_id
      and e.profile_id = group_row.profile_id
      and v.scheduled_date = group_row.scheduled_date
      and v.status::text <> 'cancelled'
    order by v.route_order nulls last, v.created_at, v.id
    limit 1;

    delete from public.route_stops s
    where s.route_id = any(group_row.route_ids)
      and s.route_id <> target_route_id;

    update public.visits v
    set status = 'cancelled',
        route_id = null,
        assigned_employee_id = null,
        crew_id = null,
        route_order = null,
        updated_at = now()
    where v.route_id = any(group_row.route_ids)
      and v.route_id <> target_route_id
      and v.status::text <> 'cancelled';

    delete from public.route_stops
    where route_id = target_route_id;

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
    join public.employees e on e.id = v.assigned_employee_id
    where v.route_id = target_route_id
      and e.profile_id = group_row.profile_id
      and v.scheduled_date = group_row.scheduled_date
      and v.status::text <> 'cancelled';

    update public.visits v
    set assigned_employee_id = target_employee_id,
        crew_id = target_crew_id,
        route_order = s.position,
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
      'employee_alias_route_repair',
      now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'employee_alias_route_repair',
      updated_at = now()
    returning version into target_version;

    update public.employee_smart_route_state
    set crew_id = target_crew_id,
        applied_order = coalesce((
          select array_agg(s.visit_id order by s.position)
          from public.route_stops s
          where s.route_id = target_route_id
        ), '{}'::uuid[]),
        route_version = target_version,
        updated_at = now()
    where route_id = target_route_id;

    delete from public.employee_smart_route_state
    where route_id = any(group_row.route_ids)
      and route_id <> target_route_id;

    delete from public.route_order_state
    where route_id = any(group_row.route_ids)
      and route_id <> target_route_id;

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
