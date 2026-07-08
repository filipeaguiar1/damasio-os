-- Damasio OS V42.4 - Scheduling & Dispatch
-- Run after supabase/07_quotes_workflow_rpc.sql.
-- Calendar and Routes now read/write real Supabase visits, routes, crews and activity history.

alter table public.visits add column if not exists route_order integer;

create or replace function public.get_scheduling_dispatch_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'active', c.active,
        'createdAt', c.created_at
      ) order by c.name)
      from crews c
      where c.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'unscheduledJobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id,
        'serviceName', j.service_name,
        'frequency', j.frequency::text,
        'nextVisitDate', j.next_visit_date,
        'customerName', cu.full_name,
        'address', p.address_line1,
        'propertyId', j.property_id,
        'customerId', j.customer_id,
        'quoteId', j.quote_id,
        'createdAt', j.created_at
      ) order by j.created_at desc)
      from jobs j
      left join customers cu on cu.id = j.customer_id
      left join properties p on p.id = j.property_id
      where j.organization_id = '00000000-0000-0000-0000-000000000001'
        and j.active = true
        and not exists (
          select 1 from visits v
          where v.job_id = j.id
            and v.organization_id = j.organization_id
            and v.status in ('scheduled','in_progress')
        )
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'jobId', v.job_id,
        'routeId', v.route_id,
        'crewId', v.crew_id,
        'crewName', cr.name,
        'employeeId', v.assigned_employee_id,
        'employeeName', e.full_name,
        'customerId', v.customer_id,
        'customerName', cu.full_name,
        'propertyId', v.property_id,
        'address', p.address_line1,
        'serviceName', j.service_name,
        'scheduledDate', v.scheduled_date,
        'status', v.status::text,
        'routeOrder', v.route_order,
        'startedAt', v.started_at,
        'finishedAt', v.finished_at,
        'createdAt', v.created_at
      ) order by v.scheduled_date asc, cr.name asc, coalesce(v.route_order, 999), v.created_at asc)
      from visits v
      left join jobs j on j.id = v.job_id
      left join customers cu on cu.id = v.customer_id
      left join properties p on p.id = v.property_id
      left join crews cr on cr.id = v.crew_id
      left join employees e on e.id = v.assigned_employee_id
      where v.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'priority', t.priority::text,
        'status', t.status::text,
        'scheduledDate', t.scheduled_date,
        'crewId', t.assigned_crew_id,
        'customerName', cu.full_name,
        'address', p.address_line1,
        'propertyId', t.property_id
      ) order by t.created_at desc)
      from tasks t
      left join customers cu on cu.id = t.customer_id
      left join properties p on p.id = t.property_id
      where t.organization_id = '00000000-0000-0000-0000-000000000001'
        and t.status <> 'resolved'
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'entityType', a.entity_type,
        'entityId', a.entity_id,
        'details', a.details,
        'createdAt', a.created_at
      ) order by a.created_at desc)
      from activity_log a
      where a.organization_id = '00000000-0000-0000-0000-000000000001'
      limit 40
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_scheduling_dispatch_board() to anon, authenticated;

create or replace function public.schedule_job_on_route(
  p_job_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_route_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_job jobs%rowtype;
  v_route uuid;
  v_visit uuid;
  v_next_order integer;
begin
  select * into v_job from jobs where id = p_job_id and organization_id = v_org;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if p_crew_id is null then raise exception 'Crew is required'; end if;
  if p_route_date is null then raise exception 'Route date is required'; end if;

  select id into v_route
  from routes
  where organization_id = v_org and crew_id = p_crew_id and route_date = p_route_date
  order by created_at asc
  limit 1;

  if v_route is null then
    insert into routes (organization_id, crew_id, route_date, status)
    values (v_org, p_crew_id, p_route_date, 'published')
    returning id into v_route;
  else
    update routes set status = 'published' where id = v_route;
  end if;

  select coalesce(max(route_order), 0) + 1 into v_next_order
  from visits where organization_id = v_org and crew_id = p_crew_id and scheduled_date = p_route_date;

  insert into visits (organization_id, job_id, route_id, customer_id, property_id, crew_id, scheduled_date, status, route_order)
  values (v_org, v_job.id, v_route, v_job.customer_id, v_job.property_id, p_crew_id, p_route_date, 'scheduled', coalesce(p_route_order, v_next_order))
  on conflict do nothing
  returning id into v_visit;

  if v_visit is null then
    select id into v_visit from visits where organization_id = v_org and job_id = v_job.id and status in ('scheduled','in_progress') limit 1;
    update visits
    set route_id = v_route, crew_id = p_crew_id, scheduled_date = p_route_date, route_order = coalesce(p_route_order, route_order, v_next_order), status = 'scheduled'
    where id = v_visit;
  end if;

  update jobs set next_visit_date = p_route_date where id = v_job.id;

  update tasks
  set assigned_crew_id = p_crew_id,
      scheduled_date = coalesce(scheduled_date, p_route_date),
      status = case when status = 'open' then 'assigned'::task_status else status end,
      assigned_at = coalesce(assigned_at, now())
  where organization_id = v_org
    and property_id = v_job.property_id
    and status in ('open','assigned','in_progress');

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Scheduled job', 'visit', v_visit, 'Job scheduled for ' || p_route_date::text || '.');

  return public.get_scheduling_dispatch_board();
end;
$$;

grant execute on function public.schedule_job_on_route(uuid, uuid, date, integer) to anon, authenticated;

create or replace function public.move_visit_to_route(
  p_visit_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_route_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_route uuid;
  v_next_order integer;
begin
  if p_crew_id is null then raise exception 'Crew is required'; end if;
  if p_route_date is null then raise exception 'Route date is required'; end if;

  select id into v_route from routes
  where organization_id = v_org and crew_id = p_crew_id and route_date = p_route_date
  order by created_at asc limit 1;

  if v_route is null then
    insert into routes (organization_id, crew_id, route_date, status)
    values (v_org, p_crew_id, p_route_date, 'published') returning id into v_route;
  end if;

  select coalesce(max(route_order), 0) + 1 into v_next_order
  from visits where organization_id = v_org and crew_id = p_crew_id and scheduled_date = p_route_date;

  update visits
  set route_id = v_route,
      crew_id = p_crew_id,
      scheduled_date = p_route_date,
      route_order = coalesce(p_route_order, v_next_order)
  where id = p_visit_id and organization_id = v_org;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Moved visit', 'visit', p_visit_id, 'Visit moved to ' || p_route_date::text || '.');

  return public.get_scheduling_dispatch_board();
end;
$$;

grant execute on function public.move_visit_to_route(uuid, uuid, date, integer) to anon, authenticated;

create or replace function public.set_visit_dispatch_status(
  p_visit_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
begin
  if p_status not in ('scheduled','in_progress','completed','missed','cancelled') then
    raise exception 'Invalid visit status';
  end if;

  update visits
  set status = p_status::visit_status,
      started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
      finished_at = case when p_status = 'completed' then now() else finished_at end
  where id = p_visit_id and organization_id = v_org;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Updated visit status', 'visit', p_visit_id, 'Visit changed to ' || p_status || '.');

  return public.get_scheduling_dispatch_board();
end;
$$;

grant execute on function public.set_visit_dispatch_status(uuid, text) to anon, authenticated;
