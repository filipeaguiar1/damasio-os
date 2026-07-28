begin;

-- Damasio OS — permanent Job ownership and temporary dated Visit execution.
-- Build assigns the permanent Job owner. Daily route publication and temporary
-- movement never change that permanent assignment.

create table if not exists public.visit_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  assignment_mode text not null check (assignment_mode in ('temporary','permanent')),
  from_employee_id uuid references public.employees(id) on delete set null,
  to_employee_id uuid not null references public.employees(id) on delete restrict,
  from_crew_id uuid references public.crews(id) on delete set null,
  to_crew_id uuid not null references public.crews(id) on delete restrict,
  scheduled_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists visit_assignment_audit_company_idx
  on public.visit_assignment_audit(company_id, created_at desc);
create index if not exists visit_assignment_audit_visit_idx
  on public.visit_assignment_audit(visit_id, created_at desc);
create index if not exists visit_assignment_audit_job_idx
  on public.visit_assignment_audit(job_id, created_at desc);

alter table public.visit_assignment_audit enable row level security;
grant select on public.visit_assignment_audit to authenticated;
grant all on public.visit_assignment_audit to service_role;

drop policy if exists visit_assignment_audit_company_read
on public.visit_assignment_audit;
create policy visit_assignment_audit_company_read
on public.visit_assignment_audit
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

-- Daily Route publication deliberately does not call assign_job_to_crew and does
-- not mutate Job recurrence fields. A dated Visit identifies who executes that
-- occurrence; the Job retains the permanent Employee selected in Build.
create or replace function public.publish_canonical_route_daily(
  p_employee_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_ordered_job_ids uuid[],
  p_source_visit_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_employee public.employees%rowtype;
  v_route_id uuid;
  v_company_id uuid;
  v_capacity integer;
  v_job_id uuid;
  v_job public.jobs%rowtype;
  v_visit public.visits%rowtype;
  v_source public.visits%rowtype;
  v_source_found boolean;
  v_existing_count integer;
  v_index integer := 0;
  v_visit_ids uuid[] := '{}'::uuid[];
  v_saved jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and active;

  if not found or v_profile.role::text not in ('admin','manager','master') then
    raise exception 'Only an active Admin can publish canonical routes.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);

  if p_route_date is null then
    raise exception 'Choose a route date.';
  end if;

  if coalesce(cardinality(p_ordered_job_ids), 0) = 0 then
    raise exception 'Keep at least one house in the route preview.';
  end if;

  if (
    select count(distinct job_id)
    from unnest(p_ordered_job_ids) as jobs(job_id)
  ) <> cardinality(p_ordered_job_ids) then
    raise exception 'The route contains duplicate Job IDs.';
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id
    and active
    and coalesce(company_id, organization_id) = v_company_id
  for update;

  if not found then
    raise exception 'The selected canonical Employee was not found.';
  end if;

  if v_employee.crew_id is null or v_employee.crew_id is distinct from p_crew_id then
    raise exception 'Employee and Crew canonical IDs do not match.';
  end if;

  v_capacity := greatest(1, coalesce(v_employee.daily_route_capacity, 16));
  if cardinality(p_ordered_job_ids) > v_capacity then
    raise exception 'Employee daily capacity exceeded: % of % houses.',
      cardinality(p_ordered_job_ids), v_capacity;
  end if;

  select id into v_route_id
  from public.routes
  where coalesce(company_id, organization_id) = v_company_id
    and crew_id = v_employee.crew_id
    and route_date = p_route_date
  for update;

  if v_route_id is null then
    insert into public.routes(
      organization_id, company_id, crew_id, route_date, status
    ) values (
      v_company_id, v_company_id, v_employee.crew_id, p_route_date, 'published'
    )
    returning id into v_route_id;
  else
    update public.routes set status = 'published' where id = v_route_id;
  end if;

  if exists (
    select 1
    from public.visits
    where route_id = v_route_id
      and status::text = 'in_progress'
  ) then
    raise exception 'An in-progress Visit blocks preview publication and movement.';
  end if;

  if exists (
    select 1
    from public.visits
    where route_id = v_route_id
      and status::text = 'completed'
      and (
        job_id is null
        or not (job_id = any(p_ordered_job_ids))
      )
  ) then
    raise exception 'Completed houses are locked and must remain on the same route.';
  end if;

  perform set_config('damasio.visit_transition_context', 'publish_canonical_route', true);
  set constraints visits_route_order_unique deferred;

  update public.visits
  set route_order = null
  where coalesce(company_id, organization_id) = v_company_id
    and status::text in ('scheduled','missed')
    and (
      route_id = v_route_id
      or id = any(coalesce(p_source_visit_ids, '{}'::uuid[]))
      or (scheduled_date = p_route_date and job_id = any(p_ordered_job_ids))
    );

  update public.visits
  set route_id = null,
      assigned_employee_id = null,
      crew_id = null,
      route_order = null
  where route_id = v_route_id
    and status::text in ('scheduled','missed')
    and (
      job_id is null
      or not (job_id = any(p_ordered_job_ids))
    );

  foreach v_job_id in array p_ordered_job_ids loop
    v_index := v_index + 1;

    select * into v_job
    from public.jobs
    where id = v_job_id
      and active
      and coalesce(company_id, organization_id) = v_company_id
    for update;

    if not found or v_job.customer_id is null or v_job.property_id is null then
      raise exception 'Job % is inactive or missing canonical Customer/Property IDs.', v_job_id;
    end if;

    select count(*) into v_existing_count
    from public.visits v
    where v.job_id = v_job_id
      and v.scheduled_date = p_route_date
      and v.status::text <> 'cancelled'
      and coalesce(v.company_id, v.organization_id) = v_company_id;

    if v_existing_count > 1 then
      raise exception 'Duplicate Visit detected for Job % on %.', v_job_id, p_route_date;
    elsif v_existing_count = 1 then
      select * into v_visit
      from public.visits v
      where v.job_id = v_job_id
        and v.scheduled_date = p_route_date
        and v.status::text <> 'cancelled'
        and coalesce(v.company_id, v.organization_id) = v_company_id
      for update;
    else
      v_visit.id := null;
    end if;

    select * into v_source
    from public.visits
    where id = any(coalesce(p_source_visit_ids, '{}'::uuid[]))
      and job_id = v_job_id
      and coalesce(company_id, organization_id) = v_company_id
    limit 1
    for update;
    v_source_found := found;

    if v_source_found and v_existing_count = 1 and v_source.id is distinct from v_visit.id then
      raise exception 'The target date already has a canonical Visit for Job %. Move cannot create another.', v_job_id;
    end if;

    if v_existing_count = 1 then
      if v_visit.status::text = 'in_progress' then
        raise exception 'This house is currently in progress and cannot be selected, moved or published.';
      elsif v_visit.status::text = 'completed' then
        if v_visit.route_id is distinct from v_route_id
           or v_visit.assigned_employee_id is distinct from v_employee.id
           or v_visit.crew_id is distinct from v_employee.crew_id
           or v_visit.route_order is distinct from v_index then
          raise exception 'Esta casa já foi concluída hoje';
        end if;
        v_visit_ids := array_append(v_visit_ids, v_visit.id);
        continue;
      elsif v_visit.status::text = 'missed' then
        raise exception 'Needs Reschedule: choose a new date and move the same Visit.';
      end if;
    elsif v_source_found then
      if v_source.status::text in ('completed','in_progress') then
        raise exception 'Completed or active Visits cannot be moved.';
      end if;
      if v_source.status::text not in ('scheduled','missed') then
        raise exception 'Only Scheduled or Needs Reschedule Visits can be moved.';
      end if;
      v_visit := v_source;
    else
      v_visit.id := null;
    end if;

    if v_visit.id is null then
      insert into public.visits(
        organization_id, company_id, job_id, route_id, customer_id, property_id,
        crew_id, assigned_employee_id, scheduled_date, status, route_order,
        started_at, finished_at, duration_seconds
      ) values (
        v_company_id, v_company_id, v_job.id, v_route_id, v_job.customer_id, v_job.property_id,
        v_employee.crew_id, v_employee.id, p_route_date, 'scheduled', v_index,
        null, null, null
      )
      returning * into v_visit;
    else
      update public.visits
      set route_id = v_route_id,
          customer_id = v_job.customer_id,
          property_id = v_job.property_id,
          crew_id = v_employee.crew_id,
          assigned_employee_id = v_employee.id,
          scheduled_date = p_route_date,
          status = 'scheduled',
          route_order = v_index,
          started_at = null,
          finished_at = null,
          duration_seconds = null
      where id = v_visit.id
      returning * into v_visit;
    end if;

    v_visit_ids := array_append(v_visit_ids, v_visit.id);
  end loop;

  if cardinality(v_visit_ids) <> cardinality(p_ordered_job_ids) then
    raise exception 'The reviewed route was not fully saved.';
  end if;

  if exists (
    select 1
    from unnest(v_visit_ids) with ordinality expected(visit_id, route_position)
    join public.visits v on v.id = expected.visit_id
    where v.route_id is distinct from v_route_id
       or v.assigned_employee_id is distinct from v_employee.id
       or v.crew_id is distinct from v_employee.crew_id
       or v.scheduled_date is distinct from p_route_date
       or v.route_order is distinct from expected.route_position::integer
       or v.customer_id is null
       or v.property_id is null
       or v.job_id is null
  ) then
    raise exception 'Canonical route verification failed after publication.';
  end if;

  insert into public.activity_log(
    organization_id, company_id, actor_profile_id, action,
    entity_type, entity_id, details, metadata
  ) values (
    v_company_id, v_company_id, v_profile.id,
    'route.daily_published', 'route', v_route_id,
    'Admin published the reviewed daily route without changing permanent Job ownership.',
    jsonb_build_object(
      'route_id', v_route_id,
      'employee_id', v_employee.id,
      'crew_id', v_employee.crew_id,
      'route_date', p_route_date,
      'visit_ids', v_visit_ids,
      'job_ids', p_ordered_job_ids,
      'source_visit_ids', coalesce(p_source_visit_ids, '{}'::uuid[]),
      'capacity', v_capacity,
      'assignment_scope', 'dated_visit_only',
      'toronto_date', (now() at time zone 'America/Toronto')::date
    )
  );

  begin
    execute 'select public.queue_route_map_rebuild($1,$2,$3)'
      using v_route_id, v_company_id, 'canonical_daily_route_published';
  exception when undefined_function then
    null;
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'jobId', v.job_id,
    'routeId', v.route_id,
    'employeeId', v.assigned_employee_id,
    'crewId', v.crew_id,
    'customerId', v.customer_id,
    'propertyId', v.property_id,
    'scheduledDate', v.scheduled_date,
    'routeOrder', v.route_order,
    'status', v.status
  ) order by v.route_order), '[]'::jsonb)
  into v_saved
  from public.visits v
  where v.id = any(v_visit_ids);

  return jsonb_build_object(
    'saved', true,
    'routeId', v_route_id,
    'employeeId', v_employee.id,
    'employeeName', v_employee.full_name,
    'capacity', v_capacity,
    'count', cardinality(v_visit_ids),
    'assignmentScope', 'dated_visit_only',
    'visits', v_saved
  );
end;
$$;

create or replace function public.move_canonical_visits(
  p_visit_ids uuid[],
  p_employee_id uuid,
  p_crew_id uuid,
  p_mode text default 'temporary'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_employee public.employees%rowtype;
  v_company_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, 'temporary')));
  v_selected_ids uuid[];
  v_move_ids uuid[];
  v_job_ids uuid[];
  v_min_date date;
  v_capacity integer;
  v_date date;
  v_route_id uuid;
  v_existing_count integer;
  v_moving_count integer;
  v_order integer;
  v_visit public.visits%rowtype;
  v_job_id uuid;
  v_selected_count integer;
  v_moved_count integer := 0;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and active;

  if not found or v_profile.role::text not in ('admin','manager','master') then
    raise exception 'Only an active Admin can move canonical Visits.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);

  if v_mode not in ('temporary','permanent') then
    raise exception 'Move mode must be temporary or permanent.';
  end if;

  select coalesce(array_agg(distinct value), '{}'::uuid[])
  into v_selected_ids
  from unnest(coalesce(p_visit_ids, '{}'::uuid[])) value;

  if coalesce(cardinality(v_selected_ids), 0) = 0 then
    raise exception 'Select at least one canonical Visit.';
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id
    and active
    and coalesce(company_id, organization_id) = v_company_id
  for update;

  if not found then
    raise exception 'The destination Employee was not found.';
  end if;

  if v_employee.crew_id is null or v_employee.crew_id is distinct from p_crew_id then
    raise exception 'Destination Employee and Crew canonical IDs do not match.';
  end if;

  select count(*), min(scheduled_date), array_agg(distinct job_id)
  into v_selected_count, v_min_date, v_job_ids
  from public.visits
  where id = any(v_selected_ids)
    and coalesce(company_id, organization_id) = v_company_id;

  if v_selected_count <> cardinality(v_selected_ids) then
    raise exception 'One or more selected Visits do not belong to this company.';
  end if;

  if v_min_date is null or v_job_ids is null then
    raise exception 'Selected Visits are missing canonical Job or date data.';
  end if;

  if exists (
    select 1
    from public.visits
    where id = any(v_selected_ids)
      and status::text <> 'scheduled'
  ) then
    raise exception 'Only Scheduled Visits can be moved. Active and completed work stays locked.';
  end if;

  if exists (
    select 1
    from public.visits
    where id = any(v_selected_ids)
      and (job_id is null or customer_id is null or property_id is null)
  ) then
    raise exception 'Every moved Visit requires canonical Job, Customer and Property IDs.';
  end if;

  if v_mode = 'temporary' then
    v_move_ids := v_selected_ids;
  else
    select coalesce(array_agg(id order by scheduled_date, route_order nulls last, created_at, id), '{}'::uuid[])
    into v_move_ids
    from public.visits
    where coalesce(company_id, organization_id) = v_company_id
      and job_id = any(v_job_ids)
      and status::text = 'scheduled'
      and scheduled_date >= v_min_date;
  end if;

  v_capacity := greatest(1, coalesce(v_employee.daily_route_capacity, 16));
  perform set_config('damasio.visit_transition_context', 'publish_canonical_route', true);
  set constraints visits_route_order_unique deferred;

  for v_date in
    select distinct scheduled_date
    from public.visits
    where id = any(v_move_ids)
    order by scheduled_date
  loop
    select id into v_route_id
    from public.routes
    where coalesce(company_id, organization_id) = v_company_id
      and crew_id = v_employee.crew_id
      and route_date = v_date
    for update;

    if v_route_id is null then
      insert into public.routes(
        organization_id, company_id, crew_id, route_date, status
      ) values (
        v_company_id, v_company_id, v_employee.crew_id, v_date, 'published'
      )
      returning id into v_route_id;
    else
      update public.routes set status = 'published' where id = v_route_id;
    end if;

    select count(*) into v_existing_count
    from public.visits
    where coalesce(company_id, organization_id) = v_company_id
      and scheduled_date = v_date
      and status::text <> 'cancelled'
      and id <> all(v_move_ids)
      and (
        assigned_employee_id = v_employee.id
        or (assigned_employee_id is null and crew_id = v_employee.crew_id)
      );

    select count(*) into v_moving_count
    from public.visits
    where id = any(v_move_ids)
      and scheduled_date = v_date;

    if v_existing_count + v_moving_count > v_capacity then
      raise exception 'Destination capacity exceeded on %: % existing + % moved, limit %.',
        v_date, v_existing_count, v_moving_count, v_capacity;
    end if;

    select coalesce(max(route_order), 0) into v_order
    from public.visits
    where route_id = v_route_id
      and status::text <> 'cancelled'
      and id <> all(v_move_ids);

    for v_visit in
      select *
      from public.visits
      where id = any(v_move_ids)
        and scheduled_date = v_date
      order by route_order nulls last, created_at, id
      for update
    loop
      v_order := v_order + 1;

      insert into public.visit_assignment_audit(
        company_id, visit_id, job_id, actor_profile_id, assignment_mode,
        from_employee_id, to_employee_id, from_crew_id, to_crew_id, scheduled_date
      ) values (
        v_company_id, v_visit.id, v_visit.job_id, v_profile.id, v_mode,
        v_visit.assigned_employee_id, v_employee.id, v_visit.crew_id, v_employee.crew_id,
        v_visit.scheduled_date
      );

      update public.visits
      set route_id = v_route_id,
          crew_id = v_employee.crew_id,
          assigned_employee_id = v_employee.id,
          route_order = v_order
      where id = v_visit.id;

      v_moved_count := v_moved_count + 1;
    end loop;
  end loop;

  if v_mode = 'permanent' then
    foreach v_job_id in array v_job_ids loop
      begin
        execute 'select public.assign_job_to_crew($1,$2)'
          using v_job_id, v_employee.crew_id;
      exception when undefined_function then
        raise exception 'Permanent Job assignment RPC is missing.';
      end;
    end loop;
  end if;

  insert into public.activity_log(
    organization_id, company_id, actor_profile_id, action,
    entity_type, entity_id, details, metadata
  ) values (
    v_company_id, v_company_id, v_profile.id,
    case when v_mode = 'temporary' then 'visit.temporarily_reassigned' else 'job.permanently_reassigned' end,
    case when v_mode = 'temporary' then 'visit' else 'job' end,
    coalesce(v_selected_ids[1], v_job_ids[1]),
    case
      when v_mode = 'temporary'
        then 'Admin changed only the dated Visit executor; permanent Job ownership was preserved.'
      else 'Admin changed permanent Job ownership and future Scheduled Visits.'
    end,
    jsonb_build_object(
      'mode', v_mode,
      'selected_visit_ids', v_selected_ids,
      'moved_visit_ids', v_move_ids,
      'job_ids', v_job_ids,
      'destination_employee_id', v_employee.id,
      'destination_crew_id', v_employee.crew_id,
      'selected_count', cardinality(v_selected_ids),
      'moved_count', v_moved_count,
      'toronto_date', (now() at time zone 'America/Toronto')::date
    )
  );

  return jsonb_build_object(
    'saved', true,
    'mode', v_mode,
    'employeeId', v_employee.id,
    'employeeName', v_employee.full_name,
    'selectedCount', cardinality(v_selected_ids),
    'movedCount', v_moved_count,
    'jobCount', cardinality(v_job_ids),
    'visitIds', v_move_ids,
    'jobIds', v_job_ids
  );
end;
$$;

revoke all on function public.publish_canonical_route_daily(uuid,uuid,date,uuid[],uuid[]) from public, anon;
revoke all on function public.move_canonical_visits(uuid[],uuid,uuid,text) from public, anon;

grant execute on function public.publish_canonical_route_daily(uuid,uuid,date,uuid[],uuid[]) to authenticated, service_role;
grant execute on function public.move_canonical_visits(uuid[],uuid,uuid,text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
