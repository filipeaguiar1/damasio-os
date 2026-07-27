begin;

-- Damasio OS V53 route integrity and audited Visit transitions.
-- This migration is intentionally additive. Do not treat it as applied until the
-- target Supabase project confirms the migration version and the RPCs below exist.

alter table if exists public.activity_log
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.visit_transition_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_role text not null,
  transition text not null check (transition in ('reset','reopen')),
  reason text not null,
  previous_status text not null,
  next_status text not null,
  dependency_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists visit_transition_audit_visit_idx
  on public.visit_transition_audit(visit_id, created_at desc);
create index if not exists visit_transition_audit_company_idx
  on public.visit_transition_audit(company_id, created_at desc);

alter table public.visit_transition_audit enable row level security;
grant select on public.visit_transition_audit to authenticated;
grant all on public.visit_transition_audit to service_role;

drop policy if exists visit_transition_audit_company_read on public.visit_transition_audit;
create policy visit_transition_audit_company_read
on public.visit_transition_audit
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select job_id, scheduled_date
    from public.visits
    where job_id is not null
      and scheduled_date is not null
      and status::text <> 'cancelled'
    group by job_id, scheduled_date
    having count(*) > 1
  ) duplicate_days;

  if v_duplicates > 0 then
    raise exception 'Cannot install Visit duplicate guard: % Job/date duplicate group(s) require explicit repair first.', v_duplicates;
  end if;
end $$;

create unique index if not exists visits_one_active_occurrence_per_job_day_idx
  on public.visits(job_id, scheduled_date)
  where status <> 'cancelled';

update public.visits
set route_id = null,
    route_order = null
where status::text = 'cancelled'
  and (route_id is not null or route_order is not null);

do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select route_id, route_order
    from public.visits
    where route_id is not null
      and route_order is not null
      and status::text <> 'cancelled'
    group by route_id, route_order
    having count(*) > 1
  ) duplicate_orders;

  if v_duplicates > 0 then
    raise exception 'Cannot install route_order guard: % duplicate route position(s) require repair first.', v_duplicates;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'visits_route_order_unique'
      and conrelid = 'public.visits'::regclass
  ) then
    alter table public.visits
      add constraint visits_route_order_unique
      unique(route_id, route_order)
      deferrable initially deferred;
  end if;
end $$;

do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select coalesce(company_id, organization_id) as company_id, crew_id, route_date
    from public.routes
    where crew_id is not null and route_date is not null
    group by coalesce(company_id, organization_id), crew_id, route_date
    having count(*) > 1
  ) duplicate_routes;

  if v_duplicates > 0 then
    raise exception 'Cannot install canonical Route guard: % Employee/date duplicate Route(s) require repair first.', v_duplicates;
  end if;
end $$;

create unique index if not exists routes_one_company_crew_day_idx
  on public.routes((coalesce(company_id, organization_id)), crew_id, route_date)
  where crew_id is not null and route_date is not null;

create or replace function public.validate_visit_canonical_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  if new.job_id is null then
    raise exception 'A canonical Visit requires job_id.';
  end if;

  select * into v_job
  from public.jobs
  where id = new.job_id;

  if not found then
    raise exception 'Canonical Job % was not found.', new.job_id;
  end if;

  if new.customer_id is distinct from v_job.customer_id then
    raise exception 'Visit customer_id must match canonical Job %.', new.job_id;
  end if;

  if new.property_id is distinct from v_job.property_id then
    raise exception 'Visit property_id must match canonical Job %.', new.job_id;
  end if;

  if coalesce(new.company_id, new.organization_id)
     is distinct from coalesce(v_job.company_id, v_job.organization_id) then
    raise exception 'Visit and Job must belong to the same company.';
  end if;

  if new.route_order is not null and new.route_order < 1 then
    raise exception 'route_order must be a positive canonical position.';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_validate_canonical_links on public.visits;
create trigger visits_validate_canonical_links
before insert or update of job_id, customer_id, property_id, company_id, organization_id, route_order
on public.visits
for each row execute function public.validate_visit_canonical_links();

create or replace function public.guard_visit_operational_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_context text := coalesce(current_setting('damasio.visit_transition_context', true), '');
  v_route_changed boolean;
begin
  v_route_changed :=
    new.route_id is distinct from old.route_id
    or new.assigned_employee_id is distinct from old.assigned_employee_id
    or new.crew_id is distinct from old.crew_id
    or new.scheduled_date is distinct from old.scheduled_date
    or new.route_order is distinct from old.route_order;

  if new.status::text is distinct from old.status::text
     and v_context not in ('transition_visit_execution','publish_canonical_route','reopen_completed_visit') then
    raise exception 'Visit status changes must use the canonical transition RPC.';
  end if;

  if old.status::text in ('completed','in_progress') and v_route_changed then
    raise exception 'Completed or active Visits cannot be moved or reordered.';
  end if;

  if old.status::text = 'completed'
     and (
       new.started_at is distinct from old.started_at
       or new.finished_at is distinct from old.finished_at
       or new.duration_seconds is distinct from old.duration_seconds
     )
     and v_context <> 'reopen_completed_visit' then
    raise exception 'A completed Visit can only be changed by the audited Reopen flow.';
  end if;

  if old.status::text = 'missed'
     and new.status::text = 'scheduled'
     and v_context not in ('publish_canonical_route','transition_visit_execution') then
    raise exception 'A missed Visit requires an explicit Needs Reschedule action.';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_operational_transition_guard on public.visits;
create trigger visits_operational_transition_guard
before update on public.visits
for each row execute function public.guard_visit_operational_transition();

create or replace function public.transition_visit_execution(
  p_visit_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_employee public.employees%rowtype;
  v_visit public.visits%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_company_id uuid;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_now timestamptz := now();
  v_allowed boolean := false;
  v_task_count integer := 0;
  v_feedback_count integer := 0;
  v_payout_count integer := 0;
  v_billing_count integer := 0;
  v_snapshot jsonb := '{}'::jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and active;

  if not found then
    raise exception 'An active authenticated profile is required.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);

  select * into v_visit
  from public.visits
  where id = p_visit_id
    and coalesce(company_id, organization_id) = v_company_id
  for update;

  if not found then
    raise exception 'Visit not found in this company.';
  end if;

  if v_profile.role::text = 'employee' then
    select * into v_employee
    from public.employees
    where profile_id = v_profile.id
      and active
      and coalesce(company_id, organization_id) = v_company_id
    limit 1;

    if not found then
      raise exception 'The Employee profile is not linked to a canonical Employee.';
    end if;

    v_allowed :=
      v_visit.assigned_employee_id = v_employee.id
      or (
        v_visit.assigned_employee_id is null
        and v_employee.crew_id is not null
        and v_visit.crew_id = v_employee.crew_id
      );
  else
    v_allowed := v_profile.role::text in ('admin','manager','master');
  end if;

  if not v_allowed then
    raise exception 'This Visit is not assigned to the authenticated Employee.';
  end if;

  if v_profile.role::text = 'employee'
     and v_visit.scheduled_date is distinct from v_today then
    raise exception 'Employees can change execution only for today in America/Toronto.';
  end if;

  perform set_config('damasio.visit_transition_context', 'transition_visit_execution', true);

  if v_action = 'start' then
    if v_visit.status::text <> 'scheduled' then
      raise exception 'Only a scheduled Visit can be started.';
    end if;

    update public.visits
    set status = 'in_progress',
        started_at = coalesce(started_at, v_now),
        finished_at = null,
        duration_seconds = null
    where id = v_visit.id
    returning * into v_visit;

  elsif v_action = 'done' then
    if v_visit.status::text not in ('scheduled','in_progress') then
      raise exception 'Only a scheduled or active Visit can be completed.';
    end if;

    update public.visits
    set status = 'completed',
        started_at = coalesce(started_at, v_now),
        finished_at = v_now,
        duration_seconds = greatest(
          0,
          round(extract(epoch from (v_now - coalesce(started_at, v_now))))::integer
        )
    where id = v_visit.id
    returning * into v_visit;

  elsif v_action = 'skip' then
    if v_visit.status::text not in ('scheduled','in_progress') then
      raise exception 'Only a scheduled or active Visit can be skipped.';
    end if;

    update public.visits
    set status = 'missed',
        finished_at = v_now,
        duration_seconds = case
          when started_at is null then null
          else greatest(0, round(extract(epoch from (v_now - started_at)))::integer)
        end
    where id = v_visit.id
    returning * into v_visit;

  elsif v_action = 'reset' then
    if v_visit.status::text <> 'in_progress' then
      raise exception 'Reset is allowed only for an active Visit. Completed work requires Reopen.';
    end if;

    if length(v_reason) < 5 then
      raise exception 'A Reset reason with at least 5 characters is required.';
    end if;

    if v_profile.role::text = 'employee'
       and (
         v_visit.started_at is null
         or v_visit.started_at < v_now - interval '20 minutes'
       ) then
      raise exception 'Employee Reset is limited to the first 20 minutes. Ask Admin after that window.';
    end if;

    update public.visits
    set status = 'scheduled',
        started_at = null,
        finished_at = null,
        duration_seconds = null
    where id = v_visit.id
    returning * into v_visit;

    insert into public.visit_transition_audit(
      company_id, visit_id, actor_profile_id, actor_role, transition, reason,
      previous_status, next_status, dependency_snapshot
    ) values (
      v_company_id, v_visit.id, v_profile.id, v_profile.role::text, 'reset', v_reason,
      'in_progress', 'scheduled',
      jsonb_build_object('route_id', v_visit.route_id, 'route_order', v_visit.route_order)
    );

  elsif v_action = 'reopen' then
    if v_visit.status::text <> 'completed' then
      raise exception 'Only a completed Visit can be reopened.';
    end if;

    if length(v_reason) < 5 then
      raise exception 'A Reopen reason with at least 5 characters is required.';
    end if;

    if to_regclass('public.tasks') is not null then
      execute $q$
        select count(*)
        from public.tasks
        where source_visit_id = $1
           or (
             property_id = $2
             and created_at >= coalesce($3, created_at)
           )
      $q$ into v_task_count using v_visit.id, v_visit.property_id, v_visit.finished_at;
    end if;

    if to_regclass('public.feedback') is not null then
      execute 'select count(*) from public.feedback where visit_id = $1'
        into v_feedback_count using v_visit.id;
    end if;

    if to_regclass('public.company_payout_items') is not null then
      execute 'select count(*) from public.company_payout_items where visit_id = $1'
        into v_payout_count using v_visit.id;
    end if;

    if to_regclass('public.visit_billing_events') is not null then
      execute 'select count(*) from public.visit_billing_events where visit_id = $1'
        into v_billing_count using v_visit.id;
    end if;

    v_snapshot := jsonb_build_object(
      'tasks', v_task_count,
      'feedback', v_feedback_count,
      'payout_items', v_payout_count,
      'billing_events', v_billing_count
    );

    if v_task_count + v_feedback_count + v_payout_count + v_billing_count > 0 then
      raise exception 'Reopen blocked: resolve Task, feedback, charge, transfer or refund dependencies first. Snapshot: %', v_snapshot;
    end if;

    if v_profile.role::text = 'employee' then
      if v_visit.assigned_employee_id is distinct from v_employee.id
         or v_visit.scheduled_date is distinct from v_today
         or v_visit.finished_at is null
         or v_visit.finished_at < v_now - interval '15 minutes' then
        raise exception 'Employee Reopen is limited to the Employee''s own Visit, today, within 15 minutes. Admin is required.';
      end if;
    elsif v_profile.role::text not in ('admin','manager','master') then
      raise exception 'Admin approval is required to reopen this Visit.';
    end if;

    perform set_config('damasio.visit_transition_context', 'reopen_completed_visit', true);

    update public.visits
    set status = 'scheduled',
        started_at = null,
        finished_at = null,
        duration_seconds = null
    where id = v_visit.id
    returning * into v_visit;

    insert into public.visit_transition_audit(
      company_id, visit_id, actor_profile_id, actor_role, transition, reason,
      previous_status, next_status, dependency_snapshot
    ) values (
      v_company_id, v_visit.id, v_profile.id, v_profile.role::text, 'reopen', v_reason,
      'completed', 'scheduled', v_snapshot
    );

  else
    raise exception 'Unsupported Visit action: %', v_action;
  end if;

  insert into public.activity_log(
    organization_id, company_id, actor_profile_id, action,
    entity_type, entity_id, details, metadata
  ) values (
    v_company_id, v_company_id, v_profile.id,
    'visit.' || v_action,
    'visit', v_visit.id,
    nullif(v_reason, ''),
    jsonb_build_object(
      'visit_id', v_visit.id,
      'job_id', v_visit.job_id,
      'route_id', v_visit.route_id,
      'route_order', v_visit.route_order,
      'scheduled_date', v_visit.scheduled_date,
      'status', v_visit.status,
      'toronto_date', v_today
    )
  );

  return jsonb_build_object(
    'id', v_visit.id,
    'jobId', v_visit.job_id,
    'routeId', v_visit.route_id,
    'routeOrder', v_visit.route_order,
    'scheduledDate', v_visit.scheduled_date,
    'status', v_visit.status,
    'startedAt', v_visit.started_at,
    'finishedAt', v_visit.finished_at,
    'durationSeconds', v_visit.duration_seconds
  );
end;
$$;

create or replace function public.reopen_completed_visit(
  p_visit_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.transition_visit_execution(p_visit_id, 'reopen', p_reason)
$$;

create or replace function public.publish_canonical_route(
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

    if found and v_existing_count = 1 and v_source.id is distinct from v_visit.id then
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
    elsif found then
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

    begin
      execute 'select public.assign_job_to_crew($1,$2)'
        using v_job.id, v_employee.crew_id;
    exception when undefined_function then
      null;
    end;

    update public.jobs
    set next_visit_date = p_route_date,
        recurrence_anchor_date = p_route_date,
        default_route_order = v_index
    where id = v_job.id;

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
    'route.published', 'route', v_route_id,
    'Admin published the reviewed canonical route.',
    jsonb_build_object(
      'route_id', v_route_id,
      'employee_id', v_employee.id,
      'crew_id', v_employee.crew_id,
      'route_date', p_route_date,
      'visit_ids', v_visit_ids,
      'job_ids', p_ordered_job_ids,
      'source_visit_ids', coalesce(p_source_visit_ids, '{}'::uuid[]),
      'capacity', v_capacity,
      'toronto_date', (now() at time zone 'America/Toronto')::date
    )
  );

  begin
    execute 'select public.queue_route_map_rebuild($1,$2,$3)'
      using v_route_id, v_company_id, 'canonical_route_published';
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
    'visits', v_saved
  );
end;
$$;

-- Smart Route may reorder only pending scheduled stops. Completed stops keep their
-- existing position, and any in-progress stop blocks the operation.
create or replace function public.apply_employee_smart_route(
  p_route_id uuid,
  p_original_order uuid[],
  p_applied_order uuid[],
  p_origin_label text,
  p_origin_latitude double precision,
  p_origin_longitude double precision,
  p_expected_version integer default null
) returns table(route_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.routes%rowtype;
  v_existing public.employee_smart_route_state%rowtype;
  v_current uuid[];
  v_mutable uuid[];
  v_requested uuid[];
  v_final uuid[] := '{}'::uuid[];
  v_id uuid;
  v_position integer := 0;
  v_mutable_position integer := 0;
  v_has_existing boolean := false;
begin
  select * into v_route from public.routes where id = p_route_id for update;
  if not found then raise exception 'Route not found.'; end if;
  if not public.employee_can_use_route(p_route_id) then
    raise exception 'You do not have access to this route.';
  end if;

  if exists (
    select 1 from public.visits
    where route_id = p_route_id and status::text = 'in_progress'
  ) then
    raise exception 'Smart Route is blocked while a Visit is in progress.';
  end if;

  select coalesce(array_agg(id order by route_order nulls last, id), '{}'::uuid[])
  into v_current
  from public.visits
  where route_id = p_route_id
    and status::text <> 'cancelled';

  select coalesce(array_agg(id order by route_order nulls last, id), '{}'::uuid[])
  into v_mutable
  from public.visits
  where route_id = p_route_id
    and status::text = 'scheduled';

  select coalesce(array_agg(distinct_id order by first_seen), '{}'::uuid[])
  into v_requested
  from (
    select distinct on (id) id as distinct_id, first_seen
    from unnest(coalesce(p_applied_order, '{}'::uuid[]))
      with ordinality as input(id, first_seen)
    where id = any(v_mutable)
    order by id, first_seen
  ) dedup;

  if cardinality(v_requested) <> cardinality(v_mutable) then
    raise exception 'Smart Route must include every pending scheduled Visit exactly once.';
  end if;

  foreach v_id in array v_current loop
    v_position := v_position + 1;
    if v_id = any(v_mutable) then
      v_mutable_position := v_mutable_position + 1;
      v_final := array_append(v_final, v_requested[v_mutable_position]);
    else
      v_final := array_append(v_final, v_id);
    end if;
  end loop;

  select * into v_existing
  from public.employee_smart_route_state
  where route_id = p_route_id
  for update;
  v_has_existing := found;

  if v_has_existing and v_existing.active
     and p_expected_version is not null
     and v_existing.route_version <> p_expected_version then
    raise exception 'Route changed on another device. Refresh before applying Smart Route.';
  end if;

  perform set_config('damasio.visit_transition_context', 'smart_route', true);
  set constraints visits_route_order_unique deferred;

  update public.visits
  set route_order = null
  where id = any(v_mutable);

  v_position := 0;
  foreach v_id in array v_final loop
    v_position := v_position + 1;
    if v_id = any(v_mutable) then
      update public.visits set route_order = v_position where id = v_id;
    else
      if exists (
        select 1 from public.visits
        where id = v_id and route_order is distinct from v_position
      ) then
        raise exception 'Completed Visit positions are locked. Refresh the route before applying Smart Route.';
      end if;
    end if;
  end loop;

  insert into public.activity_log(
    organization_id, company_id, actor_profile_id, action,
    entity_type, entity_id, details, metadata
  ) values (
    coalesce(v_route.company_id, v_route.organization_id),
    coalesce(v_route.company_id, v_route.organization_id),
    auth.uid(),
    'employee_smart_route.applied',
    'route',
    p_route_id,
    'Employee Smart Route applied to pending canonical Visits.',
    jsonb_build_object(
      'route_id', p_route_id,
      'route_date', v_route.route_date,
      'crew_id', v_route.crew_id,
      'origin_label', coalesce(p_origin_label, ''),
      'final_order', v_final
    )
  );

  insert into public.employee_smart_route_state(
    company_id, route_id, crew_id, route_date, original_order, applied_order,
    origin_label, origin_latitude, origin_longitude, active,
    applied_by_profile_id, applied_at, route_version, updated_at
  ) values (
    coalesce(v_route.company_id, v_route.organization_id),
    p_route_id,
    v_route.crew_id,
    v_route.route_date,
    case when v_has_existing and v_existing.active then v_existing.original_order else v_current end,
    v_final,
    coalesce(p_origin_label, ''),
    p_origin_latitude,
    p_origin_longitude,
    true,
    auth.uid(),
    now(),
    coalesce(v_existing.route_version, 0) + 1,
    now()
  )
  on conflict(route_id) do update set
    original_order = case
      when public.employee_smart_route_state.active
        then public.employee_smart_route_state.original_order
      else excluded.original_order
    end,
    applied_order = excluded.applied_order,
    origin_label = excluded.origin_label,
    origin_latitude = excluded.origin_latitude,
    origin_longitude = excluded.origin_longitude,
    active = true,
    applied_by_profile_id = auth.uid(),
    applied_at = now(),
    restored_at = null,
    restored_by_profile_id = null,
    route_version = public.employee_smart_route_state.route_version + 1,
    updated_at = now()
  returning public.employee_smart_route_state.route_version into route_version;

  begin
    execute 'select public.queue_route_map_rebuild($1,$2,$3)'
      using p_route_id, coalesce(v_route.company_id, v_route.organization_id), 'employee_smart_route_applied';
  exception when undefined_function then
    null;
  end;

  return next;
end;
$$;

revoke all on function public.transition_visit_execution(uuid,text,text) from public, anon;
revoke all on function public.reopen_completed_visit(uuid,text) from public, anon;
revoke all on function public.publish_canonical_route(uuid,uuid,date,uuid[],uuid[]) from public, anon;
grant execute on function public.transition_visit_execution(uuid,text,text) to authenticated, service_role;
grant execute on function public.reopen_completed_visit(uuid,text) to authenticated, service_role;
grant execute on function public.publish_canonical_route(uuid,uuid,date,uuid[],uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
