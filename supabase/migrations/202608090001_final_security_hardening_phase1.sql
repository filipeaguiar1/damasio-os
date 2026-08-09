-- Final security hardening phase 1.
-- Preserve existing business behavior while enforcing company-operator roles at the database boundary.

create or replace function public.archive_company_customers(p_customer_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company uuid;
  v_archived integer:=0;
begin
  select coalesce(p.company_id,p.organization_id)
  into v_company
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and p.role::text in ('admin','manager','master')
  limit 1;

  if auth.uid() is null or v_company is null then
    raise exception 'Active Admin, Manager or Master company access required';
  end if;

  if coalesce(array_length(p_customer_ids,1),0)=0 then return 0; end if;

  update public.customers set archived_at=now()
  where company_id=v_company and id=any(p_customer_ids) and archived_at is null;
  get diagnostics v_archived=row_count;

  update public.jobs set active=false
  where company_id=v_company and customer_id=any(p_customer_ids) and active;

  update public.visits set status='cancelled'
  where company_id=v_company and customer_id=any(p_customer_ids)
    and scheduled_date>=current_date and status='scheduled';

  return v_archived;
end;
$$;

revoke execute on function public.archive_company_customers(uuid[]) from public,anon;
grant execute on function public.archive_company_customers(uuid[]) to authenticated,service_role;

create or replace function public.assign_job_to_crew(p_job_id uuid,p_crew_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company uuid;
begin
  select coalesce(p.company_id,p.organization_id)
  into v_company
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and p.role::text in ('admin','manager','master')
  limit 1;

  if auth.uid() is null or v_company is null then
    raise exception 'Active Admin, Manager or Master company access required';
  end if;

  if p_crew_id is not null and not exists(
    select 1 from public.crews where id=p_crew_id and company_id=v_company and active
  ) then raise exception 'Crew unavailable'; end if;

  update public.jobs set default_crew_id=p_crew_id
  where id=p_job_id and company_id=v_company and active;
  if not found then raise exception 'Job not found'; end if;

  return public.get_company_dispatch_jobs();
end;
$$;

revoke execute on function public.assign_job_to_crew(uuid,uuid) from public,anon;
grant execute on function public.assign_job_to_crew(uuid,uuid) to authenticated,service_role;

create or replace function public.publish_official_route_stops(p_crew_id uuid,p_route_date date,p_visit_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company uuid;
  v_route uuid;
  v_expected integer:=coalesce(array_length(p_visit_ids,1),0);
  v_saved integer;
begin
  select coalesce(p.company_id,p.organization_id)
  into v_company
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and p.role::text in ('admin','manager','master')
  limit 1;

  if auth.uid() is null or v_company is null then
    raise exception 'Active Admin, Manager or Master company access required';
  end if;

  if p_crew_id is null then raise exception 'Crew is required'; end if;
  if p_route_date is null then raise exception 'Route date is required'; end if;
  if v_expected=0 then raise exception 'At least one route stop is required'; end if;

  perform pg_advisory_xact_lock(hashtext(v_company::text),hashtext(p_crew_id::text||':'||p_route_date::text));

  if (select count(distinct visit_id) from unnest(p_visit_ids) with ordinality as ordered(visit_id,position))<>v_expected then
    raise exception 'Route contains duplicate visits';
  end if;

  select id into v_route
  from public.routes
  where coalesce(company_id,organization_id)=v_company
    and crew_id=p_crew_id
    and route_date=p_route_date
  order by created_at asc
  limit 1;

  if v_route is null then
    insert into public.routes(organization_id,company_id,crew_id,route_date,status)
    values(v_company,v_company,p_crew_id,p_route_date,'published')
    returning id into v_route;
  else
    update public.routes set status='published' where id=v_route;
  end if;

  update public.visits v
  set route_id=v_route,
      crew_id=p_crew_id,
      scheduled_date=p_route_date,
      route_order=ordered.position::integer
  from unnest(p_visit_ids) with ordinality as ordered(visit_id,position)
  where v.id=ordered.visit_id
    and coalesce(v.company_id,v.organization_id)=v_company
    and v.status<>'cancelled';

  get diagnostics v_saved=row_count;
  if v_saved<>v_expected then
    raise exception 'Route save failed: expected % stops but saved %',v_expected,v_saved;
  end if;

  delete from public.route_stops where route_id=v_route;

  insert into public.route_stops(organization_id,company_id,route_id,visit_id,position)
  select v_company,v_company,v_route,ordered.visit_id,ordered.position::integer
  from unnest(p_visit_ids) with ordinality as ordered(visit_id,position);

  select count(*) into v_saved from public.route_stops where route_id=v_route;
  if v_saved<>v_expected then
    raise exception 'Route validation failed: expected % stops but found %',v_expected,v_saved;
  end if;

  insert into public.activity_log(organization_id,company_id,action,entity_type,entity_id,details)
  values(v_company,v_company,'Published official route','route',v_route,v_expected||' official stops saved for '||p_route_date::text||'.');

  perform public.safe_queue_route_map_rebuild(v_route,v_company,'official_route_published');

  return public.get_scheduling_dispatch_board();
end;
$$;

revoke execute on function public.publish_official_route_stops(uuid,date,uuid[]) from public,anon;
grant execute on function public.publish_official_route_stops(uuid,date,uuid[]) to authenticated,service_role;
