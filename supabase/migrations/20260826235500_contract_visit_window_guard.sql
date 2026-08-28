begin;

create or replace function public.cleanup_job_visits_after_contract_end(
  p_job_id uuid,
  p_company_id uuid,
  p_contract_end date
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
  if p_job_id is null or p_company_id is null or p_contract_end is null then
    return jsonb_build_object('removedVisits', 0, 'deletedEmptyRoutes', 0, 'routeIds', '[]'::jsonb);
  end if;

  select
    coalesce(array_agg(v.id order by v.scheduled_date, v.id), '{}'::uuid[]),
    coalesce(array_agg(distinct v.route_id) filter (where v.route_id is not null), '{}'::uuid[])
  into v_visit_ids, v_route_ids
  from public.visits v
  where v.job_id = p_job_id
    and coalesce(v.company_id, v.organization_id) = p_company_id
    and v.status::text = 'scheduled'
    and v.started_at is null
    and v.finished_at is null
    and v.scheduled_date > p_contract_end;

  v_removed := coalesce(cardinality(v_visit_ids), 0);
  if v_removed = 0 then
    return jsonb_build_object('removedVisits', 0, 'deletedEmptyRoutes', 0, 'routeIds', '[]'::jsonb);
  end if;

  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'contract_window_cleanup', true);
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
    'Automatic contract cleanup: scheduled Visit is after the active contract end date.',
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
    and status::text = 'scheduled'
    and started_at is null
    and finished_at is null;

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
      'contract_window_cleanup',
      null,
      now()
    )
    on conflict (route_id) do update set
      version = public.route_order_state.version + 1,
      last_source = 'contract_window_cleanup',
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
        'contract_window_cleanup'
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

revoke all on function public.cleanup_job_visits_after_contract_end(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.cleanup_job_visits_after_contract_end(uuid, uuid, date)
to service_role;

create or replace function public.guard_visit_against_active_contract_end()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_contract_end date;
begin
  if new.job_id is null
     or new.scheduled_date is null
     or new.status::text = 'cancelled' then
    return new;
  end if;

  select a.contract_ends_on
    into v_contract_end
  from public.billing_agreements a
  where a.job_id = new.job_id
    and a.active = true
    and a.contract_ends_on is not null
  order by a.version desc, a.created_at desc, a.id desc
  limit 1;

  if v_contract_end is not null and new.scheduled_date > v_contract_end then
    raise exception 'Visit date % exceeds active contract end % for Job %',
      new.scheduled_date, v_contract_end, new.job_id;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_active_contract_end_guard on public.visits;
create trigger visits_active_contract_end_guard
before insert or update of job_id, scheduled_date, status
on public.visits
for each row
execute function public.guard_visit_against_active_contract_end();

create or replace function public.reconcile_visit_window_after_agreement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if new.active is distinct from true
     or new.job_id is null
     or new.contract_ends_on is null then
    return new;
  end if;

  v_company_id := new.company_id;
  if v_company_id is null then
    select coalesce(j.company_id, j.organization_id)
      into v_company_id
    from public.jobs j
    where j.id = new.job_id;
  end if;

  if v_company_id is not null then
    perform public.cleanup_job_visits_after_contract_end(
      new.job_id,
      v_company_id,
      new.contract_ends_on
    );
  end if;

  return new;
end;
$$;

drop trigger if exists billing_agreements_reconcile_visit_window on public.billing_agreements;
create trigger billing_agreements_reconcile_visit_window
after insert or update of active, job_id, contract_ends_on
on public.billing_agreements
for each row
execute function public.reconcile_visit_window_after_agreement_change();

-- Reconcile legacy scheduled rows that predate the active contract window.
do $$
declare
  agreement_row record;
begin
  for agreement_row in
    select a.job_id,
           a.company_id,
           a.contract_ends_on
    from public.billing_agreements a
    where a.active = true
      and a.job_id is not null
      and a.company_id is not null
      and a.contract_ends_on is not null
  loop
    perform public.cleanup_job_visits_after_contract_end(
      agreement_row.job_id,
      agreement_row.company_id,
      agreement_row.contract_ends_on
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
