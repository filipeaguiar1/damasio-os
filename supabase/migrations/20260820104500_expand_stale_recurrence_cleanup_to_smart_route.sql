begin;

create or replace function public.cleanup_stale_recurring_route_visits(
  p_company_id uuid,
  p_crew_id uuid default null,
  p_from_date date default current_date,
  p_to_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit_ids uuid[] := '{}'::uuid[];
  v_route_ids uuid[] := '{}'::uuid[];
  v_route_id uuid;
  v_removed integer := 0;
  v_deleted_routes integer := 0;
  v_version integer;
begin
  if p_company_id is null then
    raise exception 'Company is required.';
  end if;

  if p_to_date is not null and p_to_date < p_from_date then
    raise exception 'Invalid recurrence cleanup date range.';
  end if;

  select
    coalesce(array_agg(distinct v.id), '{}'::uuid[]),
    coalesce(array_agg(distinct v.route_id) filter (where v.route_id is not null), '{}'::uuid[])
  into v_visit_ids, v_route_ids
  from public.visits v
  join public.jobs j on j.id = v.job_id
  join public.routes r on r.id = v.route_id
  join public.route_order_state ros on ros.route_id = r.id
  where coalesce(v.company_id, v.organization_id) = p_company_id
    and coalesce(j.company_id, j.organization_id) = p_company_id
    and coalesce(r.company_id, r.organization_id) = p_company_id
    and (p_crew_id is null or v.crew_id = p_crew_id)
    and v.status::text = 'scheduled'
    and v.route_id is not null
    and v.scheduled_date >= p_from_date
    and (p_to_date is null or v.scheduled_date <= p_to_date)
    and j.active = true
    and j.recurrence_anchor_date is not null
    and ros.last_source in ('admin_recurring_route_reference', 'admin_route_advisor_smart_route')
    and (
      (
        lower(coalesce(j.frequency::text, j.service_frequency, '')) = 'weekly'
        and mod((v.scheduled_date - j.recurrence_anchor_date), 7) <> 0
      )
      or
      (
        lower(replace(coalesce(j.frequency::text, j.service_frequency, ''), '_', '')) = 'biweekly'
        and mod((v.scheduled_date - j.recurrence_anchor_date), 14) <> 0
      )
    );

  v_removed := coalesce(cardinality(v_visit_ids), 0);
  if v_removed = 0 then
    return jsonb_build_object('removedVisits', 0, 'deletedEmptyRoutes', 0, 'routeIds', '[]'::jsonb);
  end if;

  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'recurrence_stale_cleanup', true);
  set constraints visits_route_order_unique deferred;

  insert into public.visit_route_removal_audit(
    company_id,
    visit_id,
    job_id,
    route_id,
    actor_profile_id,
    reason,
    previous_employee_id,
    previous_crew_id,
    previous_route_order,
    scheduled_date
  )
  select
    p_company_id,
    v.id,
    v.job_id,
    v.route_id,
    null,
    'Automatic recurrence cleanup: scheduled Visit no longer matches the Job recurrence anchor.',
    v.assigned_employee_id,
    v.crew_id,
    v.route_order,
    v.scheduled_date
  from public.visits v
  where v.id = any(v_visit_ids);

  delete from public.route_stops
  where visit_id = any(v_visit_ids);

  update public.visits
  set status = 'cancelled',
      route_id = null,
      assigned_employee_id = null,
      crew_id = null,
      route_order = null,
      updated_at = now()
  where id = any(v_visit_ids)
    and status::text = 'scheduled';

  foreach v_route_id in array v_route_ids loop
    if not exists (select 1 from public.route_stops where route_id = v_route_id)
       and not exists (
         select 1 from public.visits
         where route_id = v_route_id and status::text <> 'cancelled'
       ) then
      delete from public.routes where id = v_route_id;
      if found then v_deleted_routes := v_deleted_routes + 1; end if;
      continue;
    end if;

    update public.route_stops
    set position = position + 100000,
        updated_at = now()
    where route_id = v_route_id;

    with ranked as (
      select visit_id,
             row_number() over (order by position, visit_id)::integer as next_position
      from public.route_stops
      where route_id = v_route_id
    )
    update public.route_stops s
    set position = ranked.next_position,
        updated_at = now()
    from ranked
    where s.route_id = v_route_id
      and s.visit_id = ranked.visit_id;

    update public.visits v
    set route_order = s.position,
        updated_at = now()
    from public.route_stops s
    where s.route_id = v_route_id
      and s.visit_id = v.id
      and v.route_id = v_route_id
      and v.route_order is distinct from s.position;

    insert into public.route_order_state(
      route_id,
      company_id,
      version,
      last_source,
      last_actor_profile_id,
      updated_at
    ) values (
      v_route_id,
      p_company_id,
      2,
      'recurrence_stale_cleanup',
      null,
      now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'recurrence_stale_cleanup',
      last_actor_profile_id = null,
      updated_at = now()
    returning version into v_version;

    update public.employee_smart_route_state
    set applied_order = coalesce((
          select array_agg(s.visit_id order by s.position)
          from public.route_stops s
          where s.route_id = v_route_id
        ), '{}'::uuid[]),
        route_version = v_version,
        updated_at = now()
    where route_id = v_route_id;

    begin
      perform public.queue_route_map_rebuild(
        v_route_id,
        p_company_id,
        'recurrence_stale_cleanup'
      );
    exception when undefined_function or undefined_table then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'removedVisits', v_removed,
    'deletedEmptyRoutes', v_deleted_routes,
    'routeIds', to_jsonb(v_route_ids)
  );
end;
$$;

revoke all on function public.cleanup_stale_recurring_route_visits(uuid, uuid, date, date)
from public, anon, authenticated;
grant execute on function public.cleanup_stale_recurring_route_visits(uuid, uuid, date, date)
to service_role;

notify pgrst, 'reload schema';

commit;
