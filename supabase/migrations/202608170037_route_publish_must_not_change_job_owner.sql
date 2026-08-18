begin;

create or replace function public.save_job_route_pattern(
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
  v_company uuid:=coalesce(public.current_company_id(),'00000000-0000-0000-0000-000000000001'::uuid);
  v_job jobs%rowtype;
  v_route uuid;
  v_visit uuid;
begin
  perform public.require_active_company_operator();
  select * into v_job from jobs where id=p_job_id and company_id=v_company and active for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if not exists(select 1 from crews where id=p_crew_id and company_id=v_company and active) then raise exception 'Crew unavailable'; end if;

  -- Permanent ownership is canonical on jobs.default_crew_id. Route publication is
  -- dated scheduling only and must never silently transfer a client back to an old crew.
  if v_job.default_crew_id is distinct from p_crew_id then
    raise exception 'Route crew does not match the Job owner. Transfer the client explicitly before publishing this route.';
  end if;

  select id into v_route from routes where company_id=v_company and crew_id=p_crew_id and route_date=p_route_date order by created_at limit 1;
  if v_route is null then
    insert into routes(organization_id,company_id,crew_id,route_date,status)
    values(v_company,v_company,p_crew_id,p_route_date,'published') returning id into v_route;
  end if;

  select id into v_visit from visits where company_id=v_company and job_id=p_job_id and scheduled_date=p_route_date and status not in ('cancelled','missed') limit 1;
  if v_visit is null then
    insert into visits(organization_id,company_id,job_id,route_id,customer_id,property_id,crew_id,scheduled_date,status,route_order)
    values(v_company,v_company,v_job.id,v_route,v_job.customer_id,v_job.property_id,p_crew_id,p_route_date,'scheduled',p_route_order)
    returning id into v_visit;
  else
    update visits
    set route_id=v_route,crew_id=p_crew_id,route_order=coalesce(p_route_order,route_order),status='scheduled'
    where id=v_visit;
  end if;

  update jobs
  set recurrence_anchor_date=coalesce(recurrence_anchor_date,p_route_date),
      default_route_order=coalesce(p_route_order,default_route_order),
      next_visit_date=p_route_date
  where id=p_job_id;

  return public.get_scheduling_dispatch_board();
end;
$$;

revoke all on function public.save_job_route_pattern(uuid,uuid,date,integer) from public, anon;
grant execute on function public.save_job_route_pattern(uuid,uuid,date,integer) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
