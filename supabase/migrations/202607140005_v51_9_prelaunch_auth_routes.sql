-- Damasio OS V51.9 — pre-launch database correction and real-user roles.
-- Run once in Supabase SQL Editor.

alter type public.visit_status add value if not exists 'missed';
alter type public.app_role add value if not exists 'manager';

begin;

alter table public.customers add column if not exists archived_at timestamptz;
alter table public.profiles add column if not exists manager_permissions jsonb not null default '{}'::jsonb;

-- Correct Auth onboarding: invited people join the inviter's company instead of creating a new one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_company_name text;v_slug text;v_role app_role;
begin
  v_role:=case when coalesce(new.raw_user_meta_data->>'role','') in ('master','admin','manager','employee','customer') then (new.raw_user_meta_data->>'role')::app_role else 'customer'::app_role end;
  begin v_company:=(new.raw_user_meta_data->>'company_id')::uuid;exception when others then v_company:=null;end;
  if v_company is not null and not exists(select 1 from public.organizations where id=v_company and active) then v_company:=null;end if;

  if v_company is null and v_role='admin' then
    v_company_name:=coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'),''),'New Company');
    v_slug:=trim(both '-' from lower(regexp_replace(v_company_name,'[^a-zA-Z0-9]+','-','g')));
    insert into public.organizations(name,slug) values(v_company_name,coalesce(nullif(v_slug,''),'company')||'-'||substr(new.id::text,1,8)) returning id into v_company;
  end if;

  insert into public.profiles(id,organization_id,company_id,role,full_name,email,active)
  values(new.id,v_company,v_company,v_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),new.email),new.email,true)
  on conflict(id) do update set full_name=excluded.full_name,email=excluded.email;
  return new;
end $$;

-- Cancel duplicate active visits left by older route publishers. History is retained.
with duplicate_visits as (
  select id,row_number() over(partition by company_id,job_id,scheduled_date order by created_at,id) as position
  from public.visits
  where job_id is not null and status not in ('cancelled','missed')
)
update public.visits v set status='cancelled'
from duplicate_visits d where d.id=v.id and d.position>1;

create unique index if not exists visits_company_job_day_active_unique
  on public.visits(company_id,job_id,scheduled_date)
  where job_id is not null and status not in ('cancelled','missed');

create or replace function public.archive_company_customers(p_customer_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_archived integer:=0;
begin
  select coalesce(company_id,organization_id) into v_company
  from public.profiles
  where id=auth.uid() and active and role::text in ('admin','manager')
    and (role::text='admin' or coalesce(manager_permissions->>'customers','none')='manage')
  limit 1;
  if v_company is null then raise exception 'Company Admin or Customer Manager access required'; end if;
  if coalesce(array_length(p_customer_ids,1),0)=0 then return 0; end if;

  update public.customers set archived_at=now()
  where company_id=v_company and id=any(p_customer_ids) and archived_at is null;
  get diagnostics v_archived=row_count;

  update public.jobs set active=false
  where company_id=v_company and customer_id=any(p_customer_ids) and active;
  update public.visits set status='cancelled'
  where company_id=v_company and customer_id=any(p_customer_ids)
    and scheduled_date>=current_date and status in ('scheduled','on_the_way');
  return v_archived;
end $$;

revoke all on function public.archive_company_customers(uuid[]) from public,anon;
grant execute on function public.archive_company_customers(uuid[]) to authenticated;

-- Internal operational data and mutations require a signed-in account.
revoke execute on function public.get_customer_property_directory() from anon;
revoke execute on function public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from anon;
revoke execute on function public.get_scheduling_dispatch_board() from anon;
revoke execute on function public.schedule_job_on_route(uuid,uuid,date,integer) from anon;
revoke execute on function public.move_visit_to_route(uuid,uuid,date,integer) from anon;
revoke execute on function public.set_visit_dispatch_status(uuid,text) from anon;
revoke execute on function public.get_company_referral_inbox() from anon;
revoke execute on function public.respond_company_referral(uuid,boolean) from anon;
revoke execute on function public.create_job_for_customer_property(uuid,uuid,text,text) from anon;
revoke execute on function public.get_company_dispatch_jobs() from anon;
revoke execute on function public.assign_job_to_crew(uuid,uuid) from anon;
revoke execute on function public.save_job_route_pattern(uuid,uuid,date,integer) from anon;

grant execute on function public.get_customer_property_directory() to authenticated;
grant execute on function public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;
grant execute on function public.get_scheduling_dispatch_board() to authenticated;
grant execute on function public.schedule_job_on_route(uuid,uuid,date,integer) to authenticated;
grant execute on function public.move_visit_to_route(uuid,uuid,date,integer) to authenticated;
grant execute on function public.set_visit_dispatch_status(uuid,text) to authenticated;
grant execute on function public.get_company_referral_inbox() to authenticated;
grant execute on function public.respond_company_referral(uuid,boolean) to authenticated;
grant execute on function public.create_job_for_customer_property(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_company_dispatch_jobs() to authenticated;
grant execute on function public.assign_job_to_crew(uuid,uuid) to authenticated;
grant execute on function public.save_job_route_pattern(uuid,uuid,date,integer) to authenticated;

create or replace function public.claim_quote_by_number(p_quote_number text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_quote quotes%rowtype;v_email text:=lower(coalesce(auth.jwt()->>'email',''));v_customer uuid;
begin
  if auth.uid() is null or v_email='' then raise exception 'Authenticated email required'; end if;
  select * into v_quote from quotes where upper(quote_number)=upper(trim(p_quote_number)) and status='sent' for update;
  if v_quote.id is null then raise exception 'Quote is not available for claiming'; end if;
  if lower(coalesce(v_quote.customer_email,(select email from customers where id=v_quote.customer_id),''))<>v_email then raise exception 'Email does not match this quote'; end if;
  v_customer:=v_quote.customer_id;
  if v_customer is null then raise exception 'Quote has no customer record'; end if;
  update customers set profile_id=auth.uid() where id=v_customer and company_id=v_quote.company_id and (profile_id is null or profile_id=auth.uid());
  if not found then raise exception 'Customer account is already linked'; end if;
  update profiles set organization_id=v_quote.company_id,company_id=v_quote.company_id,role='customer',active=true where id=auth.uid();
  update quote_invitations set status='claimed',claimed_by=auth.uid(),claimed_at=now() where quote_id=v_quote.id and email ilike v_email;
  return v_quote.id;
end $$;
revoke all on function public.claim_quote_by_number(text) from public,anon;
grant execute on function public.claim_quote_by_number(text) to authenticated;

-- Customer Portal is scoped to the signed-in customer's own profile/property.
create or replace function public.get_customer_portal_board()
returns jsonb language sql security definer set search_path=public as $$
  with owned as (
    select c.company_id,c.id customer_id,p.id property_id
    from customers c join properties p on p.customer_id=c.id and p.company_id=c.company_id
    join profiles pr on pr.id=c.profile_id and pr.company_id=c.company_id
    where c.profile_id=auth.uid() and c.archived_at is null and pr.active and pr.role::text='customer'
    order by p.created_at limit 1
  )
  select jsonb_build_object(
    'property',coalesce((select jsonb_build_object('customerId',c.id,'propertyId',p.id,'customerName',c.full_name,'email',c.email,'phone',c.phone,'address',p.address_line1,'city',p.city,'province',p.province,'postalCode',p.postal_code,'lotSize',p.lot_size,'grassHeight',p.grass_height,'gate',p.gate,'dog',p.dog,'irrigation',p.irrigation,'accessNotes',p.access_notes,'propertyNotes',p.property_notes) from owned o join customers c on c.id=o.customer_id join properties p on p.id=o.property_id),'null'::jsonb),
    'visits',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'serviceName',coalesce(j.service_name,'Service Visit'),'status',v.status::text,'scheduledDate',v.scheduled_date,'crewName',cr.name,'address',p.address_line1,'propertyId',v.property_id,'customerVisibleSummary',v.customer_visible_summary,'employeeNotes',v.employee_notes,'durationSeconds',v.duration_seconds,'startedAt',v.started_at,'finishedAt',v.finished_at,'createdAt',v.created_at) order by v.scheduled_date desc,v.created_at desc) from owned o join visits v on v.company_id=o.company_id and v.customer_id=o.customer_id and v.property_id=o.property_id left join jobs j on j.id=v.job_id left join properties p on p.id=v.property_id left join crews cr on cr.id=v.crew_id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'customerIssue',t.customer_issue,'priority',t.priority::text,'status',t.status::text,'scheduledDate',t.scheduled_date,'address',p.address_line1,'propertyId',t.property_id,'resolvedAt',t.resolved_at,'completionSummary',t.completion_summary,'createdAt',t.created_at) order by t.created_at desc) from owned o join tasks t on t.company_id=o.company_id and t.customer_id=o.customer_id and t.property_id=o.property_id left join properties p on p.id=t.property_id),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',sr.id,'serviceName',sr.service_name,'message',sr.message,'status',sr.status,'address',p.address_line1,'createdAt',sr.created_at) order by sr.created_at desc) from owned o join service_requests sr on sr.company_id=o.company_id and sr.customer_id=o.customer_id and sr.property_id=o.property_id left join properties p on p.id=sr.property_id),'[]'::jsonb),
    'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'quoteNumber',q.quote_number,'status',q.status::text,'serviceName',coalesce(sr.service_name,q.notes,'Service Quote'),'address',p.address_line1,'subtotal',q.subtotal,'tax',q.tax,'total',q.total,'notes',q.notes,'createdAt',q.created_at) order by q.created_at desc) from owned o join quotes q on q.company_id=o.company_id and q.customer_id=o.customer_id and q.property_id=o.property_id left join service_requests sr on sr.id=q.request_id left join properties p on p.id=q.property_id),'[]'::jsonb),
    'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'rating',f.rating,'comment',f.comment,'visitId',f.visit_id,'taskId',f.task_id,'createdAt',f.created_at) order by f.created_at desc) from owned o join feedback f on f.company_id=o.company_id and f.customer_id=o.customer_id and f.property_id=o.property_id),'[]'::jsonb)
  )
$$;

create or replace function public.create_customer_portal_request(p_service_name text,p_message text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_customer uuid;v_property uuid;v_request uuid;
begin
  select c.company_id,c.id,p.id into v_company,v_customer,v_property from customers c join properties p on p.customer_id=c.id and p.company_id=c.company_id join profiles pr on pr.id=c.profile_id where c.profile_id=auth.uid() and c.archived_at is null and pr.active and pr.role::text='customer' order by p.created_at limit 1;
  if v_customer is null then raise exception 'Customer property not found for this account'; end if;
  if nullif(trim(coalesce(p_service_name,'')),'') is null then raise exception 'Service name is required'; end if;
  insert into service_requests(organization_id,company_id,customer_id,property_id,service_name,message,status) values(v_company,v_company,v_customer,v_property,trim(p_service_name),nullif(trim(coalesce(p_message,'')),''),'pending') returning id into v_request;
  insert into activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details) values(v_company,v_company,auth.uid(),'Customer requested service','service_request',v_request,trim(p_service_name));
  return public.get_customer_portal_board();
end $$;

create or replace function public.submit_customer_portal_feedback(p_visit_id uuid default null,p_task_id uuid default null,p_rating integer default 5,p_comment text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_company uuid;v_customer uuid;v_property uuid;v_feedback uuid;v_task uuid;
begin
  select c.company_id,c.id,p.id into v_company,v_customer,v_property from customers c join properties p on p.customer_id=c.id and p.company_id=c.company_id join profiles pr on pr.id=c.profile_id where c.profile_id=auth.uid() and c.archived_at is null and pr.active and pr.role::text='customer' order by p.created_at limit 1;
  if v_customer is null then raise exception 'Customer property not found for this account'; end if;
  if p_rating is null or p_rating<1 or p_rating>5 then raise exception 'Rating must be 1 to 5'; end if;
  if p_visit_id is not null and not exists(select 1 from visits where id=p_visit_id and company_id=v_company and customer_id=v_customer and property_id=v_property) then raise exception 'Visit not found for this customer'; end if;
  insert into feedback(organization_id,company_id,customer_id,property_id,visit_id,task_id,rating,comment) values(v_company,v_company,v_customer,v_property,p_visit_id,p_task_id,p_rating,nullif(trim(coalesce(p_comment,'')),'')) returning id into v_feedback;
  if p_rating<=3 and nullif(trim(coalesce(p_comment,'')),'') is not null then insert into tasks(organization_id,company_id,customer_id,property_id,source_visit_id,title,customer_issue,priority,status) values(v_company,v_company,v_customer,v_property,p_visit_id,'Customer feedback follow-up',trim(p_comment),'urgent','open') returning id into v_task;end if;
  return public.get_customer_portal_board();
end $$;

revoke all on function public.get_customer_portal_board() from public,anon;
revoke all on function public.create_customer_portal_request(text,text) from public,anon;
revoke all on function public.submit_customer_portal_feedback(uuid,uuid,integer,text) from public,anon;
grant execute on function public.get_customer_portal_board() to authenticated;
grant execute on function public.create_customer_portal_request(text,text) to authenticated;
grant execute on function public.submit_customer_portal_feedback(uuid,uuid,integer,text) to authenticated;

commit;
