-- Canonical daily operations dashboard for Admin mobile and desktop.
begin;

create or replace function public.get_live_daily_operations(p_date date default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with actor as (
    select coalesce(company_id,organization_id) company_id
    from profiles where id=auth.uid() and active and role::text in ('admin','manager')
  ), selected_day as (
    select coalesce(p_date,timezone('America/Toronto',now())::date) work_date
  ), visit_rows as (
    select v.id visit_id,v.property_id,v.customer_id,v.scheduled_date,v.status::text status,
      v.started_at,v.finished_at,v.duration_seconds,v.employee_notes,v.customer_visible_summary,
      c.full_name customer_name,p.address_line1,p.city,p.province,p.postal_code,
      coalesce(j.service_name,'Property Service') service_name,
      coalesce(e.full_name,cr.name,'Unassigned') assigned_to
    from actor a cross join selected_day d
    join visits v on v.company_id=a.company_id and v.scheduled_date=d.work_date
    join properties p on p.id=v.property_id and p.company_id=v.company_id
    join customers c on c.id=v.customer_id and c.company_id=v.company_id
    left join jobs j on j.id=v.job_id
    left join employees e on e.id=v.assigned_employee_id
    left join crews cr on cr.id=v.crew_id
  ), task_rows as (
    select t.id task_id,t.property_id,t.scheduled_date,t.status::text status,t.priority::text priority,
      t.title,t.customer_issue,t.created_at,t.work_started_at,t.work_finished_at,t.completion_summary,
      c.full_name customer_name,p.address_line1,p.city,p.province,p.postal_code,
      coalesce(e.full_name,cr.name,'Unassigned') assigned_to
    from actor a cross join selected_day d
    join tasks t on t.company_id=a.company_id
      and (t.scheduled_date=d.work_date or (t.scheduled_date is null and t.status::text in ('open','assigned','in_progress','completed')))
    join properties p on p.id=t.property_id and p.company_id=t.company_id
    join customers c on c.id=t.customer_id and c.company_id=t.company_id
    left join employees e on e.id=t.assigned_employee_id
    left join crews cr on cr.id=t.assigned_crew_id
  ), visit_json as (
    select jsonb_build_object(
      'id',visit_id,'propertyId',property_id,'customerId',customer_id,'scheduledDate',scheduled_date,
      'status',status,'startedAt',started_at,'finishedAt',finished_at,'durationSeconds',duration_seconds,
      'employeeNotes',employee_notes,'customerVisibleSummary',customer_visible_summary,
      'customerName',customer_name,'address',concat_ws(', ',address_line1,city,province,postal_code),
      'city',coalesce(nullif(trim(city),''),'Other Ontario'),'province',province,
      'serviceName',service_name,'assignedTo',assigned_to
    ) row from visit_rows
  ), task_json as (
    select jsonb_build_object(
      'id',task_id,'propertyId',property_id,'scheduledDate',scheduled_date,'status',status,'priority',priority,
      'title',title,'customerIssue',customer_issue,'createdAt',created_at,'workStartedAt',work_started_at,
      'workFinishedAt',work_finished_at,'completionSummary',completion_summary,'customerName',customer_name,
      'address',concat_ws(', ',address_line1,city,province,postal_code),'city',coalesce(nullif(trim(city),''),'Other Ontario'),
      'province',province,'assignedTo',assigned_to
    ) row from task_rows
  ), city_rows as (
    select coalesce(nullif(trim(city),''),'Other Ontario') city,
      count(*) total,
      count(*) filter(where status='completed') completed,
      count(*) filter(where status not in ('completed','cancelled','missed')) remaining
    from visit_rows group by coalesce(nullif(trim(city),''),'Other Ontario')
  ), assignee_rows as (
    select assigned_to,
      count(*) total,
      count(*) filter(where status='completed') completed,
      count(*) filter(where status='in_progress') in_progress,
      count(*) filter(where status not in ('completed','cancelled','missed')) remaining
    from visit_rows group by assigned_to
  )
  select jsonb_build_object(
    'date',(select work_date from selected_day),
    'summary',jsonb_build_object(
      'homesTotal',(select count(*) from visit_rows),
      'homesOpen',(select count(*) from visit_rows where status not in ('completed','cancelled','missed')),
      'homesInProgress',(select count(*) from visit_rows where status='in_progress'),
      'homesDone',(select count(*) from visit_rows where status='completed'),
      'homesMissed',(select count(*) from visit_rows where status='missed'),
      'tasksOpen',(select count(*) from task_rows where status in ('open','assigned','in_progress')),
      'tasksInProgress',(select count(*) from task_rows where status='in_progress'),
      'tasksDone',(select count(*) from task_rows where status in ('completed','resolved')),
      'urgentTasks',(select count(*) from task_rows where priority='urgent' and status not in ('completed','resolved','cancelled')),
      'unassignedHomes',(select count(*) from visit_rows where assigned_to='Unassigned' and status not in ('completed','cancelled','missed')),
      'unassignedTasks',(select count(*) from task_rows where assigned_to='Unassigned' and status not in ('completed','resolved','cancelled'))
    ),
    'visits',coalesce((select jsonb_agg(row order by row->>'city',row->>'address') from visit_json),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(row order by case row->>'priority' when 'urgent' then 0 else 1 end,row->>'createdAt' desc) from task_json),'[]'::jsonb),
    'cities',coalesce((select jsonb_agg(jsonb_build_object('city',city,'total',total,'completed',completed,'remaining',remaining) order by city) from city_rows),'[]'::jsonb),
    'assignees',coalesce((select jsonb_agg(jsonb_build_object('name',assigned_to,'total',total,'completed',completed,'inProgress',in_progress,'remaining',remaining) order by assigned_to) from assignee_rows),'[]'::jsonb)
  );
$$;

revoke all on function public.get_live_daily_operations(date) from public,anon;
grant execute on function public.get_live_daily_operations(date) to authenticated,service_role;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='visits') then
    alter publication supabase_realtime add table public.visits;
  end if;
exception when undefined_object then null;
end $$;

commit;
