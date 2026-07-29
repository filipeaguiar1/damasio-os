-- Restore the canonical Customer feedback/request contract for environments that
-- received the portal board before the write RPCs and table grants.
begin;

alter table public.feedback enable row level security;
alter table public.service_requests enable row level security;
alter table public.tasks enable row level security;

grant select, insert on table public.feedback to authenticated;
grant select, insert on table public.service_requests to authenticated;
grant select, insert on table public.tasks to authenticated;
grant select, insert, update, delete on table public.feedback to service_role;
grant select, insert, update, delete on table public.service_requests to service_role;
grant select, insert, update, delete on table public.tasks to service_role;
revoke all privileges on table public.feedback from anon;
revoke all privileges on table public.service_requests from anon;
revoke all privileges on table public.tasks from anon;

create or replace function public.create_customer_portal_request(
  p_service_name text,
  p_message text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_customer public.customers%rowtype;
  v_property public.properties%rowtype;
  v_company_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated Customer required'; end if;

  select * into v_profile
  from public.profiles
  where id=auth.uid() and active and role::text='customer';
  if v_profile.id is null then raise exception 'Active Customer profile required'; end if;

  select * into v_customer
  from public.customers
  where profile_id=auth.uid() and archived_at is null
  order by created_at
  limit 1;
  if v_customer.id is null then raise exception 'Customer record is not linked to this account'; end if;

  v_company_id := coalesce(v_customer.company_id,v_customer.organization_id,v_profile.company_id,v_profile.organization_id);
  if v_company_id is null then raise exception 'Customer company identity is missing'; end if;

  select * into v_property
  from public.properties
  where customer_id=v_customer.id
    and coalesce(company_id,organization_id)=v_company_id
  order by created_at
  limit 1;
  if v_property.id is null then raise exception 'Customer property not found'; end if;

  if nullif(trim(coalesce(p_service_name,'')),'') is null then
    raise exception 'Service name is required';
  end if;

  insert into public.service_requests(
    organization_id,company_id,customer_id,property_id,service_name,message,status
  ) values(
    v_company_id,v_company_id,v_customer.id,v_property.id,trim(p_service_name),
    nullif(trim(coalesce(p_message,'')),''),'pending'
  );

  return public.get_customer_portal_board();
end;
$$;

create or replace function public.submit_customer_portal_feedback(
  p_visit_id uuid default null,
  p_task_id uuid default null,
  p_rating integer default null,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_customer public.customers%rowtype;
  v_company_id uuid;
  v_property_id uuid;
  v_feedback_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated Customer required'; end if;
  if (p_visit_id is null)=(p_task_id is null) then
    raise exception 'Choose exactly one completed Visit or resolved Task';
  end if;
  if p_rating is null or p_rating<1 or p_rating>5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  select * into v_profile
  from public.profiles
  where id=auth.uid() and active and role::text='customer';
  if v_profile.id is null then raise exception 'Active Customer profile required'; end if;

  select * into v_customer
  from public.customers
  where profile_id=auth.uid() and archived_at is null
  order by created_at
  limit 1;
  if v_customer.id is null then raise exception 'Customer record is not linked to this account'; end if;

  v_company_id := coalesce(v_customer.company_id,v_customer.organization_id,v_profile.company_id,v_profile.organization_id);
  if v_company_id is null then raise exception 'Customer company identity is missing'; end if;

  if p_visit_id is not null then
    select property_id into v_property_id
    from public.visits
    where id=p_visit_id
      and customer_id=v_customer.id
      and coalesce(company_id,organization_id)=v_company_id
      and status='completed';
    if v_property_id is null then raise exception 'Completed Visit not found for this Customer'; end if;
  else
    select property_id into v_property_id
    from public.tasks
    where id=p_task_id
      and customer_id=v_customer.id
      and coalesce(company_id,organization_id)=v_company_id
      and status='resolved';
    if v_property_id is null then raise exception 'Resolved Task not found for this Customer'; end if;
  end if;

  insert into public.feedback(
    organization_id,company_id,customer_id,property_id,visit_id,task_id,rating,comment
  ) values(
    v_company_id,v_company_id,v_customer.id,v_property_id,p_visit_id,p_task_id,p_rating,
    nullif(trim(coalesce(p_comment,'')),'')
  ) returning id into v_feedback_id;

  if p_rating<=3 and nullif(trim(coalesce(p_comment,'')),'') is not null then
    insert into public.tasks(
      organization_id,company_id,customer_id,property_id,source_visit_id,title,
      customer_issue,priority,status
    ) values(
      v_company_id,v_company_id,v_customer.id,v_property_id,p_visit_id,
      'Customer feedback follow-up',trim(p_comment),'urgent','open'
    );
  end if;

  return public.get_customer_portal_board();
end;
$$;

revoke all on function public.create_customer_portal_request(text,text) from public,anon;
revoke all on function public.submit_customer_portal_feedback(uuid,uuid,integer,text) from public,anon;
grant execute on function public.create_customer_portal_request(text,text) to authenticated,service_role;
grant execute on function public.submit_customer_portal_feedback(uuid,uuid,integer,text) to authenticated,service_role;

commit;
