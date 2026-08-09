-- Final security hardening phase 2.
-- Keeps existing product flows intact while enforcing role and tenant scope.

begin;

create or replace function public.require_active_company_operator()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role::text in ('admin','manager','master')
  ) then
    raise exception 'Active Admin, Manager or Master company access required';
  end if;

  return true;
end;
$$;

revoke execute on function public.require_active_company_operator() from public, anon;
grant execute on function public.require_active_company_operator() to authenticated, service_role;

create or replace function public.get_customer_property_directory()
returns table(
  customer_id uuid,
  property_id uuid,
  full_name text,
  email text,
  phone text,
  customer_notes text,
  address_line1 text,
  city text,
  province text,
  postal_code text,
  lot_size text,
  grass_height text,
  gate boolean,
  dog boolean,
  irrigation boolean,
  access_notes text,
  property_notes text,
  official_photo_url text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    p.id,
    c.full_name,
    c.email,
    c.phone,
    c.notes,
    p.address_line1,
    p.city,
    p.province,
    p.postal_code,
    p.lot_size::text,
    p.grass_height::text,
    p.gate,
    p.dog,
    p.irrigation,
    p.access_notes,
    p.property_notes,
    p.official_photo_url,
    p.created_at
  from public.customers c
  join public.properties p
    on p.customer_id = c.id
   and coalesce(p.company_id,p.organization_id) = coalesce(c.company_id,c.organization_id)
  where public.require_active_company_operator()
    and coalesce(c.company_id,c.organization_id) = public.current_company_id()
    and c.archived_at is null
  order by p.created_at desc;
$$;

create or replace function public.get_company_dispatch_jobs()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',j.id,
    'serviceName',j.service_name,
    'frequency',j.frequency::text,
    'nextVisitDate',j.next_visit_date,
    'customerName',c.full_name,
    'address',p.address_line1,
    'propertyId',j.property_id,
    'customerId',j.customer_id,
    'quoteId',j.quote_id,
    'crewId',j.default_crew_id,
    'crewName',cr.name,
    'recurrenceAnchorDate',j.recurrence_anchor_date,
    'defaultRouteOrder',j.default_route_order,
    'createdAt',j.created_at
  ) order by c.full_name,p.address_line1),'[]'::jsonb)
  from public.jobs j
  join public.customers c on c.id=j.customer_id
  left join public.properties p on p.id=j.property_id
  left join public.crews cr on cr.id=j.default_crew_id
  where public.require_active_company_operator()
    and coalesce(j.company_id,j.organization_id)=public.current_company_id()
    and j.active;
$$;

create or replace function public.get_company_referral_inbox()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,
    'fullName',l.full_name,
    'email',l.email,
    'phone',l.phone,
    'address',l.address,
    'serviceRequested',l.service_requested,
    'notes',l.notes,
    'status',l.status,
    'createdAt',l.created_at
  ) order by l.created_at desc),'[]'::jsonb)
  from public.lead_center l
  where public.require_active_company_operator()
    and l.assigned_company_id=public.current_company_id()
    and l.status in ('offered','accepted','declined','converted');
$$;

create or replace function public.get_operations_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,
        'quoteNumber',q.quote_number,
        'status',q.status::text,
        'customerId',q.customer_id,
        'propertyId',q.property_id,
        'customerName',c.full_name,
        'address',p.address_line1,
        'serviceName',coalesce(sr.service_name,q.notes,'Service Quote'),
        'subtotal',q.subtotal,
        'tax',q.tax,
        'total',q.total,
        'notes',q.notes,
        'createdAt',q.created_at
      ) order by q.created_at desc)
      from public.quotes q
      left join public.customers c on c.id=q.customer_id
      left join public.properties p on p.id=q.property_id
      left join public.service_requests sr on sr.id=q.request_id
      where coalesce(q.company_id,q.organization_id)=public.current_company_id()
    ),'[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',j.id,
        'serviceName',j.service_name,
        'frequency',j.frequency::text,
        'active',j.active,
        'nextVisitDate',j.next_visit_date,
        'customerName',c.full_name,
        'address',p.address_line1,
        'quoteId',j.quote_id,
        'propertyId',j.property_id,
        'createdAt',j.created_at
      ) order by j.created_at desc)
      from public.jobs j
      left join public.customers c on c.id=j.customer_id
      left join public.properties p on p.id=j.property_id
      where coalesce(j.company_id,j.organization_id)=public.current_company_id()
    ),'[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,
        'title',t.title,
        'customerIssue',t.customer_issue,
        'priority',t.priority::text,
        'status',t.status::text,
        'scheduledDate',t.scheduled_date,
        'customerName',c.full_name,
        'address',p.address_line1,
        'propertyId',t.property_id,
        'createdAt',t.created_at,
        'resolvedAt',t.resolved_at,
        'completionSummary',t.completion_summary
      ) order by t.created_at desc)
      from public.tasks t
      left join public.customers c on c.id=t.customer_id
      left join public.properties p on p.id=t.property_id
      where coalesce(t.company_id,t.organization_id)=public.current_company_id()
    ),'[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'action',a.action,
        'entityType',a.entity_type,
        'entityId',a.entity_id,
        'details',a.details,
        'createdAt',a.created_at
      ) order by a.created_at desc)
      from public.activity_log a
      where coalesce(a.company_id,a.organization_id)=public.current_company_id()
    ),'[]'::jsonb)
  )
  where public.require_active_company_operator();
$$;

create or replace function public.get_scheduling_dispatch_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.active,'createdAt',c.created_at) order by c.name)
      from public.crews c
      where coalesce(c.company_id,c.organization_id)=public.current_company_id()
    ),'[]'::jsonb),
    'unscheduledJobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',j.id,'serviceName',j.service_name,'frequency',j.frequency::text,'nextVisitDate',j.next_visit_date,
        'customerName',cu.full_name,'address',p.address_line1,'propertyId',j.property_id,'customerId',j.customer_id,
        'quoteId',j.quote_id,'createdAt',j.created_at
      ) order by j.created_at desc)
      from public.jobs j
      left join public.customers cu on cu.id=j.customer_id
      left join public.properties p on p.id=j.property_id
      where coalesce(j.company_id,j.organization_id)=public.current_company_id()
        and j.active=true
        and not exists (
          select 1 from public.visits v
          where v.job_id=j.id
            and coalesce(v.company_id,v.organization_id)=coalesce(j.company_id,j.organization_id)
            and v.status in ('scheduled','in_progress')
        )
    ),'[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',v.id,'jobId',v.job_id,'routeId',v.route_id,'crewId',v.crew_id,'crewName',cr.name,
        'employeeId',v.assigned_employee_id,'employeeName',e.full_name,'customerId',v.customer_id,
        'customerName',cu.full_name,'propertyId',v.property_id,'address',p.address_line1,
        'serviceName',j.service_name,'scheduledDate',v.scheduled_date,'status',v.status::text,
        'routeOrder',coalesce(rs.position,v.route_order),'officialStopId',rs.id,
        'startedAt',v.started_at,'finishedAt',v.finished_at,'durationSeconds',v.duration_seconds,
        'createdAt',v.created_at
      ) order by v.scheduled_date asc,cr.name asc,coalesce(rs.position,v.route_order,999),v.created_at asc)
      from public.visits v
      left join public.route_stops rs on rs.visit_id=v.id and rs.route_id=v.route_id
      left join public.jobs j on j.id=v.job_id
      left join public.customers cu on cu.id=v.customer_id
      left join public.properties p on p.id=v.property_id
      left join public.crews cr on cr.id=v.crew_id
      left join public.employees e on e.id=v.assigned_employee_id
      where coalesce(v.company_id,v.organization_id)=public.current_company_id()
    ),'[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'title',t.title,'priority',t.priority::text,'status',t.status::text,'scheduledDate',t.scheduled_date,
        'crewId',t.assigned_crew_id,'customerName',cu.full_name,'address',p.address_line1,'propertyId',t.property_id
      ) order by t.created_at desc)
      from public.tasks t
      left join public.customers cu on cu.id=t.customer_id
      left join public.properties p on p.id=t.property_id
      where coalesce(t.company_id,t.organization_id)=public.current_company_id()
        and t.status <> 'resolved'
    ),'[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'action',a.action,'entityType',a.entity_type,'entityId',a.entity_id,'details',a.details,'createdAt',a.created_at
      ) order by a.created_at desc)
      from public.activity_log a
      where coalesce(a.company_id,a.organization_id)=public.current_company_id()
    ),'[]'::jsonb)
  )
  where public.require_active_company_operator();
$$;

create or replace function public.create_operation_quote(
  p_customer_id uuid,
  p_property_id uuid,
  p_service_name text,
  p_subtotal numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid:=public.current_company_id();
  v_quote uuid;
  v_quote_number text;
  v_tax numeric(10,2);
  v_total numeric(10,2);
begin
  perform public.require_active_company_operator();
  if v_company is null then raise exception 'Company context is required'; end if;
  if p_customer_id is null or p_property_id is null then raise exception 'Customer and property are required'; end if;
  if not exists(
    select 1
    from public.customers c
    join public.properties p on p.id=p_property_id and p.customer_id=c.id
    where c.id=p_customer_id
      and coalesce(c.company_id,c.organization_id)=v_company
      and coalesce(p.company_id,p.organization_id)=v_company
  ) then raise exception 'Customer or property is unavailable for this company'; end if;

  v_quote_number:='Q-'||to_char(now(),'YYYYMMDD')||'-'||lpad((
    select (count(*)+1)::text from public.quotes q
    where coalesce(q.company_id,q.organization_id)=v_company
  ),4,'0');
  v_tax:=round(coalesce(p_subtotal,0)*0.13,2);
  v_total:=round(coalesce(p_subtotal,0)+v_tax,2);

  insert into public.quotes(organization_id,company_id,customer_id,property_id,quote_number,status,subtotal,tax,total,notes)
  values(v_company,v_company,p_customer_id,p_property_id,v_quote_number,'draft',coalesce(p_subtotal,0),v_tax,v_total,nullif(trim(coalesce(p_notes,p_service_name)),''))
  returning id into v_quote;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
  values(v_company,v_company,auth.uid(),'Created quote','quote',v_quote,coalesce(p_service_name,'Service quote')||' created.');

  return public.get_operations_board();
end;
$$;

create or replace function public.create_operation_task(
  p_customer_id uuid,
  p_property_id uuid,
  p_title text,
  p_customer_issue text,
  p_priority text default 'normal',
  p_scheduled_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid:=public.current_company_id();
  v_task uuid;
begin
  perform public.require_active_company_operator();
  if v_company is null then raise exception 'Company context is required'; end if;
  if p_priority not in ('low','normal','urgent') then p_priority:='normal'; end if;
  if not exists(
    select 1
    from public.customers c
    join public.properties p on p.id=p_property_id and p.customer_id=c.id
    where c.id=p_customer_id
      and coalesce(c.company_id,c.organization_id)=v_company
      and coalesce(p.company_id,p.organization_id)=v_company
  ) then raise exception 'Customer or property is unavailable for this company'; end if;

  insert into public.tasks(organization_id,company_id,customer_id,property_id,title,customer_issue,priority,status,scheduled_date)
  values(v_company,v_company,p_customer_id,p_property_id,trim(p_title),trim(p_customer_issue),p_priority::task_priority,'open',p_scheduled_date)
  returning id into v_task;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
  values(v_company,v_company,auth.uid(),'Created task','task',v_task,trim(p_title));

  return public.get_operations_board();
end;
$$;

create or replace function public.resolve_operation_task(p_task_id uuid,p_completion_summary text default 'Task resolved by Admin.')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid:=public.current_company_id();
begin
  perform public.require_active_company_operator();
  if v_company is null then raise exception 'Company context is required'; end if;

  update public.tasks
  set status='resolved',resolved_at=now(),completion_summary=nullif(trim(coalesce(p_completion_summary,'Task resolved.')),'')
  where id=p_task_id and coalesce(company_id,organization_id)=v_company;
  if not found then raise exception 'Task not found'; end if;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
  values(v_company,v_company,auth.uid(),'Resolved task','task',p_task_id,coalesce(p_completion_summary,'Task resolved.'));

  return public.get_operations_board();
end;
$$;

create or replace function public.set_operation_quote_status(p_quote_id uuid,p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid:=public.current_company_id();
  v_quote public.quotes%rowtype;
  v_job uuid;
begin
  perform public.require_active_company_operator();
  if v_company is null then raise exception 'Company context is required'; end if;
  if p_status not in ('draft','sent','approved','declined','expired') then raise exception 'Invalid quote status'; end if;

  update public.quotes
  set status=p_status::quote_status
  where id=p_quote_id and coalesce(company_id,organization_id)=v_company
  returning * into v_quote;
  if v_quote.id is null then raise exception 'Quote not found'; end if;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
  values(v_company,v_company,auth.uid(),'Updated quote status','quote',v_quote.id,'Quote '||v_quote.quote_number||' changed to '||p_status||'.');

  if p_status='approved' and not exists(
    select 1 from public.jobs j
    where j.quote_id=v_quote.id and coalesce(j.company_id,j.organization_id)=v_company
  ) then
    insert into public.jobs(organization_id,company_id,customer_id,property_id,quote_id,service_name,frequency,active,next_visit_date)
    values(v_company,v_company,v_quote.customer_id,v_quote.property_id,v_quote.id,coalesce(nullif(v_quote.notes,''),'Approved Service'),'one_time',true,current_date+1)
    returning id into v_job;

    insert into public.tasks(organization_id,company_id,customer_id,property_id,title,customer_issue,priority,status,scheduled_date)
    values
      (v_company,v_company,v_quote.customer_id,v_quote.property_id,'Schedule first visit','Quote approved. Confirm the first service date with the customer.','normal','open',current_date+1),
      (v_company,v_company,v_quote.customer_id,v_quote.property_id,'Prepare crew checklist','Review quote notes, property access and service expectations before dispatch.','normal','open',current_date+1);

    insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
    values
      (v_company,v_company,auth.uid(),'Created job from approved quote','job',v_job,'Job created from quote '||v_quote.quote_number||'.'),
      (v_company,v_company,auth.uid(),'Created workflow tasks','quote',v_quote.id,'First visit and crew preparation tasks created automatically.');
  end if;

  return public.get_operations_board();
end;
$$;

create or replace function public.respond_company_referral(p_lead_id uuid,p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid:=public.current_company_id();
  v_lead public.lead_center%rowtype;
  v_customer uuid;
  v_property uuid;
  v_job uuid;
  v_frequency service_frequency;
  v_service text;
begin
  perform public.require_active_company_operator();
  if v_company is null then raise exception 'Company context is required'; end if;

  select * into v_lead
  from public.lead_center
  where id=p_lead_id
    and assigned_company_id=v_company
    and status='offered'
  for update;
  if v_lead.id is null then raise exception 'Referral is unavailable or already answered'; end if;

  if not p_accept then
    update public.lead_center set status='declined',updated_at=now() where id=p_lead_id;
    return public.get_company_referral_inbox();
  end if;

  v_service:=coalesce(nullif(trim(v_lead.service_requested),''),'Property Service');
  v_frequency:=case
    when lower(v_service) like '%biweekly%' or lower(v_service) like '%bi-weekly%' then 'biweekly'::service_frequency
    when lower(v_service) like '%monthly%' then 'monthly'::service_frequency
    when lower(v_service) like '%weekly%' then 'weekly'::service_frequency
    else 'one_time'::service_frequency
  end;

  insert into public.customers(organization_id,company_id,full_name,email,phone,notes,source_master_profile_id,source_lead_id)
  values(v_company,v_company,v_lead.full_name,v_lead.email,v_lead.phone,v_lead.notes,v_lead.created_by_master_id,v_lead.id)
  returning id into v_customer;

  insert into public.properties(organization_id,company_id,customer_id,address_line1,city,province,country)
  values(v_company,v_company,v_customer,coalesce(nullif(trim(v_lead.address),''),'Address pending'),'Hamilton','ON','Canada')
  returning id into v_property;

  insert into public.jobs(organization_id,company_id,customer_id,property_id,service_name,frequency,active)
  values(v_company,v_company,v_customer,v_property,v_service,v_frequency,true)
  returning id into v_job;

  update public.lead_center set status='converted',accepted_at=now(),updated_at=now() where id=p_lead_id;

  insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(v_lead.created_by_master_id,v_company,'lead.accepted_by_company','lead_center',v_lead.id,
    jsonb_build_object('customer_id',v_customer,'property_id',v_property,'job_id',v_job));

  return public.get_company_referral_inbox();
end;
$$;

revoke execute on function public.get_customer_property_directory() from public,anon;
revoke execute on function public.get_company_dispatch_jobs() from public,anon;
revoke execute on function public.get_company_referral_inbox() from public,anon;
revoke execute on function public.get_operations_board() from public,anon;
revoke execute on function public.get_scheduling_dispatch_board() from public,anon;
revoke execute on function public.create_operation_quote(uuid,uuid,text,numeric,text) from public,anon;
revoke execute on function public.create_operation_task(uuid,uuid,text,text,text,date) from public,anon;
revoke execute on function public.resolve_operation_task(uuid,text) from public,anon;
revoke execute on function public.set_operation_quote_status(uuid,text) from public,anon;
revoke execute on function public.respond_company_referral(uuid,boolean) from public,anon;

grant execute on function public.get_customer_property_directory() to authenticated,service_role;
grant execute on function public.get_company_dispatch_jobs() to authenticated,service_role;
grant execute on function public.get_company_referral_inbox() to authenticated,service_role;
grant execute on function public.get_operations_board() to authenticated,service_role;
grant execute on function public.get_scheduling_dispatch_board() to authenticated,service_role;
grant execute on function public.create_operation_quote(uuid,uuid,text,numeric,text) to authenticated,service_role;
grant execute on function public.create_operation_task(uuid,uuid,text,text,text,date) to authenticated,service_role;
grant execute on function public.resolve_operation_task(uuid,text) to authenticated,service_role;
grant execute on function public.set_operation_quote_status(uuid,text) to authenticated,service_role;
grant execute on function public.respond_company_referral(uuid,boolean) to authenticated,service_role;

commit;
