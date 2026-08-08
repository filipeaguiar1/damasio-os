begin;

create or replace function public.remove_visits_from_today_route(
  p_visit_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_company_id uuid;
  v_reason text := trim(coalesce(p_reason, ''));
  v_visit public.visits%rowtype;
  v_route_id uuid;
  v_route_ids uuid[] := '{}'::uuid[];
  v_count integer := 0;
  v_version integer;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and active;

  if not found or v_profile.role::text not in ('admin','manager','master') then
    raise exception 'Only an active Admin can remove Visits from today.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);
  if v_company_id is null then
    raise exception 'Admin profile is not linked to a company.';
  end if;

  if coalesce(cardinality(p_visit_ids), 0) = 0 then
    raise exception 'Select at least one Visit.';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A removal reason is required.';
  end if;

  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'remove_from_today', true);
  set constraints visits_route_order_unique deferred;

  for v_visit in
    select *
    from public.visits
    where id = any(p_visit_ids)
      and coalesce(company_id, organization_id) = v_company_id
    for update
  loop
    if v_visit.status::text in ('in_progress','completed') then
      raise exception 'Active or completed Visits cannot be removed from today.';
    end if;

    if v_visit.status::text <> 'scheduled' then
      raise exception 'Only Scheduled Visits can be removed from today.';
    end if;

    if v_visit.route_id is not null and not (v_visit.route_id = any(v_route_ids)) then
      v_route_ids := array_append(v_route_ids, v_visit.route_id);
    end if;

    insert into public.visit_route_removal_audit(
      company_id, visit_id, job_id, route_id, actor_profile_id, reason,
      previous_employee_id, previous_crew_id, previous_route_order, scheduled_date
    ) values (
      v_company_id, v_visit.id, v_visit.job_id, v_visit.route_id, v_profile.id,
      v_reason, v_visit.assigned_employee_id, v_visit.crew_id,
      v_visit.route_order, v_visit.scheduled_date
    );

    delete from public.route_stops
    where visit_id = v_visit.id;

    update public.visits
    set route_id = null,
        assigned_employee_id = null,
        crew_id = null,
        route_order = null
    where id = v_visit.id;

    v_count := v_count + 1;
  end loop;

  if v_count <> cardinality(p_visit_ids) then
    raise exception 'One or more selected Visits were not found for this company.';
  end if;

  foreach v_route_id in array v_route_ids loop
    update public.route_stops
    set position = position + 100000
    where route_id = v_route_id;

    with ranked as (
      select visit_id,
             row_number() over (order by position, visit_id)::integer as next_position
      from public.route_stops
      where route_id = v_route_id
    )
    update public.route_stops s
    set position = ranked.next_position
    from ranked
    where s.route_id = v_route_id
      and s.visit_id = ranked.visit_id;

    update public.visits v
    set route_order = s.position
    from public.route_stops s
    where s.route_id = v_route_id
      and s.visit_id = v.id
      and v.route_id = v_route_id
      and v.route_order is distinct from s.position;

    insert into public.route_order_state(
      route_id, company_id, version, last_source,
      last_actor_profile_id, updated_at
    ) values (
      v_route_id, v_company_id, 2, 'admin_remove_from_today',
      v_profile.id, now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'admin_remove_from_today',
      last_actor_profile_id = v_profile.id,
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
        v_company_id,
        'admin_remove_from_today'
      );
    exception when undefined_function or undefined_table then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'removed', true,
    'count', v_count,
    'status', 'pending',
    'routeIds', v_route_ids
  );
end;
$$;

revoke all on function public.remove_visits_from_today_route(uuid[], text)
from public, anon;
grant execute on function public.remove_visits_from_today_route(uuid[], text)
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
