-- Canonical task workflow shared by Customer, Admin and Employee devices.
alter type public.task_status add value if not exists 'completed';

begin;

alter table public.tasks add column if not exists work_started_at timestamptz;
alter table public.tasks add column if not exists work_finished_at timestamptz;
alter table public.tasks add column if not exists completed_by_profile_id uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists completion_duration_seconds integer;
alter table public.tasks add column if not exists admin_resolved_at timestamptz;

create index if not exists tasks_company_status_history
on public.tasks(company_id,status,coalesce(admin_resolved_at,resolved_at,created_at) desc);

create or replace function public.get_live_task_board()
returns jsonb language sql security definer set search_path=public as $$
  with actor as (
    select pr.id,pr.role::text role,coalesce(pr.company_id,pr.organization_id) company_id,
      e.id employee_id,e.crew_id,c.id customer_id
    from profiles pr left join employees e on e.profile_id=pr.id and e.active
    left join customers c on c.profile_id=pr.id and c.archived_at is null
    where pr.id=auth.uid() and pr.active
  ), allowed_tasks as (
    select t.*,cu.full_name customer_name,p.address_line1,p.city,p.province,p.postal_code,
      p.official_photo_url,e.full_name employee_name,cr.name crew_name
    from actor a join tasks t on t.company_id=a.company_id
    join customers cu on cu.id=t.customer_id join properties p on p.id=t.property_id
    left join employees e on e.id=t.assigned_employee_id left join crews cr on cr.id=t.assigned_crew_id
    where a.role in ('admin','manager') or (a.role='customer' and t.customer_id=a.customer_id)
      or (a.role='employee' and (t.assigned_employee_id=a.employee_id or t.assigned_crew_id=a.crew_id))
  ), task_rows as (
    select t.id,t.customer_id,t.property_id,t.title,t.customer_issue,t.priority::text priority,t.status::text status,
      t.scheduled_date,t.created_at,t.assigned_at,t.work_started_at,t.work_finished_at,t.resolved_at,
      t.admin_resolved_at,t.completion_duration_seconds,t.completion_summary,t.completed_by_profile_id,
      t.customer_name,t.address_line1,t.city,t.province,t.postal_code,t.employee_name,t.crew_name,
      coalesce(jsonb_agg(jsonb_build_object('id',ph.id,'bucket',ph.storage_bucket,'storagePath',ph.storage_path,
        'type',ph.photo_type,'caption',ph.caption,'createdAt',ph.created_at) order by ph.created_at)
        filter(where ph.id is not null),'[]'::jsonb) photos
    from allowed_tasks t left join photos ph on ph.task_id=t.id and ph.property_id=t.property_id
    group by t.id,t.customer_id,t.property_id,t.title,t.customer_issue,t.priority,t.status,t.scheduled_date,t.created_at,
      t.assigned_at,t.work_started_at,t.work_finished_at,t.resolved_at,t.admin_resolved_at,t.completion_duration_seconds,
      t.completion_summary,t.completed_by_profile_id,t.customer_name,t.address_line1,t.city,t.province,t.postal_code,
      t.employee_name,t.crew_name
  )
  select jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(task_rows) order by created_at desc) from task_rows),'[]'::jsonb));
$$;

create or replace function public.start_assigned_task(p_task_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_employee employees%rowtype;
begin
  select * into v_employee from employees where profile_id=auth.uid() and active limit 1;
  if v_employee.id is null then raise exception 'Active Employee account required'; end if;
  update tasks set status='in_progress',work_started_at=coalesce(work_started_at,now())
  where id=p_task_id and company_id=v_employee.company_id and status='assigned'
    and (assigned_employee_id=v_employee.id or assigned_crew_id=v_employee.crew_id);
  if not found then raise exception 'Assigned task was not found'; end if;
end $$;

create or replace function public.complete_assigned_task(p_task_id uuid,p_summary text)
returns void language plpgsql security definer set search_path=public as $$
declare v_employee employees%rowtype;v_started timestamptz;
begin
  select * into v_employee from employees where profile_id=auth.uid() and active limit 1;
  if v_employee.id is null then raise exception 'Active Employee account required'; end if;
  select work_started_at into v_started from tasks where id=p_task_id and company_id=v_employee.company_id
    and status='in_progress' and (assigned_employee_id=v_employee.id or assigned_crew_id=v_employee.crew_id) for update;
  if not found then raise exception 'Task must be started before completion'; end if;
  update tasks set status='completed',work_finished_at=now(),completed_by_profile_id=auth.uid(),
    completion_duration_seconds=greatest(0,extract(epoch from(now()-coalesce(v_started,now())))::integer),
    completion_summary=nullif(trim(coalesce(p_summary,'')),'') where id=p_task_id;
end $$;

create or replace function public.resolve_completed_task(p_task_id uuid,p_summary text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_company uuid;
begin
  select coalesce(company_id,organization_id) into v_company from profiles where id=auth.uid() and active and role::text in('admin','manager');
  if v_company is null then raise exception 'Admin or Manager access required'; end if;
  update tasks set status='resolved',resolved_at=now(),admin_resolved_at=now(),
    completion_summary=coalesce(nullif(trim(coalesce(p_summary,'')),''),completion_summary)
  where id=p_task_id and company_id=v_company and status='completed';
  if not found then raise exception 'Completed task was not found'; end if;
end $$;

create or replace function public.register_task_photo(p_task_id uuid,p_storage_path text,p_photo_type text,p_caption text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_task tasks%rowtype;v_actor profiles%rowtype;v_photo uuid;
begin
  select * into v_actor from profiles where id=auth.uid() and active;
  select * into v_task from tasks where id=p_task_id and company_id=coalesce(v_actor.company_id,v_actor.organization_id);
  if v_task.id is null then raise exception 'Task not found'; end if;
  if split_part(p_storage_path,'/',1)<>v_task.company_id::text or split_part(p_storage_path,'/',2)<>v_task.property_id::text or split_part(p_storage_path,'/',3)<>v_task.id::text then raise exception 'Invalid task photo path'; end if;
  if p_photo_type not in('issue','completion') then raise exception 'Invalid task photo type'; end if;
  if v_actor.role::text='customer' and (p_photo_type<>'issue' or not exists(select 1 from customers where id=v_task.customer_id and profile_id=auth.uid())) then raise exception 'Customer may only attach issue evidence'; end if;
  if v_actor.role::text='employee' and (p_photo_type<>'completion' or not exists(select 1 from employees e where e.profile_id=auth.uid() and e.active and (e.id=v_task.assigned_employee_id or e.crew_id=v_task.assigned_crew_id))) then raise exception 'Employee may only attach assigned completion evidence'; end if;
  if v_actor.role::text not in('admin','manager','employee','customer') then raise exception 'Photo access denied'; end if;
  insert into photos(organization_id,company_id,property_id,task_id,uploaded_by,storage_path,storage_bucket,public_url,photo_type,is_profile,caption)
  values(v_task.company_id,v_task.company_id,v_task.property_id,v_task.id,auth.uid(),p_storage_path,'task-photos',null,p_photo_type,false,nullif(trim(coalesce(p_caption,'')),'')) returning id into v_photo;
  return v_photo;
end $$;

create or replace function public.can_write_company_photo_path(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from profiles pr where pr.id=auth.uid() and pr.active
      and split_part(p_path,'/',1)=coalesce(pr.company_id,pr.organization_id)::text and (
        pr.role::text in('admin','manager')
        or (pr.role::text='employee' and exists(select 1 from tasks t join employees e on e.profile_id=pr.id and e.active where t.id::text=split_part(p_path,'/',3) and t.property_id::text=split_part(p_path,'/',2) and (t.assigned_employee_id=e.id or t.assigned_crew_id=e.crew_id)))
        or (pr.role::text='customer' and exists(select 1 from tasks t join customers c on c.id=t.customer_id where t.id::text=split_part(p_path,'/',3) and t.property_id::text=split_part(p_path,'/',2) and c.profile_id=pr.id))
      )
  )
$$;

revoke all on function public.get_live_task_board() from public,anon;
revoke all on function public.start_assigned_task(uuid) from public,anon;
revoke all on function public.complete_assigned_task(uuid,text) from public,anon;
revoke all on function public.resolve_completed_task(uuid,text) from public,anon;
revoke all on function public.register_task_photo(uuid,text,text,text) from public,anon;
grant execute on function public.get_live_task_board() to authenticated,service_role;
grant execute on function public.start_assigned_task(uuid) to authenticated;
grant execute on function public.complete_assigned_task(uuid,text) to authenticated;
grant execute on function public.resolve_completed_task(uuid,text) to authenticated;
grant execute on function public.register_task_photo(uuid,text,text,text) to authenticated;

commit;
