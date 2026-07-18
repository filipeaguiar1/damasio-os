-- End-to-end task dispatch shared by Customer, Admin and Employee devices.
begin;

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check(event_type in ('created','assigned','unassigned','rescheduled','started','completed','resolved')),
  audience text[] not null default array['admin']::text[],
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_events_company_created
on public.task_events(company_id,created_at desc);
create index if not exists task_events_task_created
on public.task_events(task_id,created_at desc);

alter table public.task_events enable row level security;
drop policy if exists task_events_company_read on public.task_events;
create policy task_events_company_read on public.task_events for select to authenticated
using (
  company_id=public.current_company_id() and (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role::text in ('admin','manager'))
    or exists(select 1 from public.tasks t join public.customers c on c.id=t.customer_id where t.id=task_id and c.profile_id=auth.uid() and c.archived_at is null)
    or exists(select 1 from public.tasks t join public.employees e on e.profile_id=auth.uid() and e.active where t.id=task_id and (t.assigned_employee_id=e.id or t.assigned_crew_id=e.crew_id))
  )
);
grant select on public.task_events to authenticated;
grant all privileges on public.task_events to service_role;

create or replace function public.get_task_dispatch_workers()
returns jsonb language sql security definer set search_path=public as $$
  with actor as (
    select coalesce(company_id,organization_id) company_id from profiles
    where id=auth.uid() and active and role::text in ('admin','manager')
  )
  select jsonb_build_object(
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name) from actor a join employees e on e.company_id=a.company_id and e.active),'[]'::jsonb),
    'crews',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from actor a join crews c on c.company_id=a.company_id),'[]'::jsonb)
  );
$$;

create or replace function public.create_customer_task(
  p_property_id uuid,
  p_title text,
  p_issue text,
  p_priority text default 'normal'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_customer customers%rowtype;v_company uuid;v_task uuid;
begin
  select c.* into v_customer from customers c join properties p on p.customer_id=c.id and p.company_id=c.company_id
  where p.id=p_property_id and c.profile_id=auth.uid() and c.archived_at is null limit 1;
  if v_customer.id is null then raise exception 'Customer property was not found'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_issue,'')),'') is null then raise exception 'Title and issue are required'; end if;
  if p_priority not in ('low','normal','urgent') then raise exception 'Invalid priority'; end if;
  v_company:=coalesce(v_customer.company_id,v_customer.organization_id);
  insert into tasks(organization_id,company_id,customer_id,property_id,title,customer_issue,priority,status)
  values(v_company,v_company,v_customer.id,p_property_id,trim(p_title),trim(p_issue),p_priority::task_priority,'open') returning id into v_task;
  insert into task_events(organization_id,company_id,task_id,actor_profile_id,event_type,audience,details)
  values(v_company,v_company,v_task,auth.uid(),'created',array['admin','customer'],jsonb_build_object('source','customer'));
  return v_task;
end $$;

create or replace function public.create_admin_task(
  p_property_id uuid,
  p_title text,
  p_issue text,
  p_priority text default 'normal',
  p_scheduled_date date default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_customer uuid;v_task uuid;
begin
  select coalesce(company_id,organization_id) into v_company from profiles where id=auth.uid() and active and role::text in ('admin','manager');
  if v_company is null then raise exception 'Admin or Manager access required'; end if;
  select customer_id into v_customer from properties where id=p_property_id and company_id=v_company;
  if v_customer is null then raise exception 'Company property was not found'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_issue,'')),'') is null then raise exception 'Title and issue are required'; end if;
  if p_priority not in ('low','normal','urgent') then raise exception 'Invalid priority'; end if;
  insert into tasks(organization_id,company_id,customer_id,property_id,title,customer_issue,priority,status,scheduled_date)
  values(v_company,v_company,v_customer,p_property_id,trim(p_title),trim(p_issue),p_priority::task_priority,'open',p_scheduled_date) returning id into v_task;
  insert into task_events(organization_id,company_id,task_id,actor_profile_id,event_type,audience,details)
  values(v_company,v_company,v_task,auth.uid(),'created',array['admin'],jsonb_build_object('source','admin','scheduledDate',p_scheduled_date));
  return v_task;
end $$;

create or replace function public.assign_task(
  p_task_id uuid,
  p_employee_id uuid default null,
  p_crew_id uuid default null,
  p_scheduled_date date default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_previous_date date;v_event text;
begin
  select coalesce(company_id,organization_id) into v_company from profiles where id=auth.uid() and active and role::text in ('admin','manager');
  if v_company is null then raise exception 'Admin or Manager access required'; end if;
  if (p_employee_id is null)=(p_crew_id is null) then raise exception 'Choose exactly one Employee or Crew'; end if;
  if p_employee_id is not null and not exists(select 1 from employees where id=p_employee_id and company_id=v_company and active) then raise exception 'Active Employee was not found'; end if;
  if p_crew_id is not null and not exists(select 1 from crews where id=p_crew_id and company_id=v_company) then raise exception 'Crew was not found'; end if;
  select scheduled_date into v_previous_date from tasks where id=p_task_id and company_id=v_company and status in ('open','assigned') for update;
  if not found then raise exception 'Open task was not found'; end if;
  v_event:=case when v_previous_date is distinct from p_scheduled_date then 'rescheduled' else 'assigned' end;
  update tasks set assigned_employee_id=p_employee_id,assigned_crew_id=p_crew_id,scheduled_date=p_scheduled_date,status='assigned',assigned_at=now() where id=p_task_id;
  insert into task_events(organization_id,company_id,task_id,actor_profile_id,event_type,audience,details)
  values(v_company,v_company,p_task_id,auth.uid(),v_event,array['admin','employee','customer'],jsonb_build_object('employeeId',p_employee_id,'crewId',p_crew_id,'scheduledDate',p_scheduled_date));
end $$;

create or replace function public.unassign_task(p_task_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_company uuid;
begin
  select coalesce(company_id,organization_id) into v_company from profiles where id=auth.uid() and active and role::text in ('admin','manager');
  if v_company is null then raise exception 'Admin or Manager access required'; end if;
  update tasks set assigned_employee_id=null,assigned_crew_id=null,status='open',assigned_at=null
  where id=p_task_id and company_id=v_company and status='assigned';
  if not found then raise exception 'Assigned task was not found'; end if;
  insert into task_events(organization_id,company_id,task_id,actor_profile_id,event_type,audience)
  values(v_company,v_company,p_task_id,auth.uid(),'unassigned',array['admin','customer']);
end $$;

create or replace function public.record_task_status_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_event:=case new.status::text when 'in_progress' then 'started' when 'completed' then 'completed' when 'resolved' then 'resolved' else null end;
  if v_event is not null then
    insert into task_events(organization_id,company_id,task_id,actor_profile_id,event_type,audience,details)
    values(new.organization_id,new.company_id,new.id,auth.uid(),v_event,array['admin','employee','customer'],jsonb_build_object('from',old.status::text,'to',new.status::text));
  end if;
  return new;
end $$;
drop trigger if exists tasks_status_event on public.tasks;
create trigger tasks_status_event after update of status on public.tasks for each row execute function public.record_task_status_event();

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tasks') then alter publication supabase_realtime add table public.tasks; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='task_events') then alter publication supabase_realtime add table public.task_events; end if;
exception when undefined_object then null;
end $$;

revoke all on function public.create_customer_task(uuid,text,text,text) from public,anon;
revoke all on function public.get_task_dispatch_workers() from public,anon;
revoke all on function public.create_admin_task(uuid,text,text,text,date) from public,anon;
revoke all on function public.assign_task(uuid,uuid,uuid,date) from public,anon;
revoke all on function public.unassign_task(uuid) from public,anon;
grant execute on function public.create_customer_task(uuid,text,text,text) to authenticated;
grant execute on function public.get_task_dispatch_workers() to authenticated;
grant execute on function public.create_admin_task(uuid,text,text,text,date) to authenticated;
grant execute on function public.assign_task(uuid,uuid,uuid,date) to authenticated;
grant execute on function public.unassign_task(uuid) to authenticated;

commit;
