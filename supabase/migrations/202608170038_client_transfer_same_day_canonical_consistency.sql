begin;

create or replace function public.transfer_customer_jobs_without_date(
  p_job_ids uuid[],
  p_employee_id uuid,
  p_crew_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_company_id uuid;
  v_job_ids uuid[] := '{}'::uuid[];
  v_visit_ids uuid[] := '{}'::uuid[];
  v_source_routes uuid[] := '{}'::uuid[];
  v_route_id uuid;
  v_moved_jobs integer := 0;
  v_moved_visits integer := 0;
begin
  select p.* into v_profile from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_profile.role::text not in ('admin','manager','master') then
    raise exception 'Only an active Admin can transfer customers.';
  end if;
  v_company_id:=coalesce(v_profile.company_id,v_profile.organization_id);

  if p_employee_id is null or p_crew_id is null then
    raise exception 'Destination Employee and Crew are required.';
  end if;
  if not exists(
    select 1 from public.employees e
    where e.id=p_employee_id and e.crew_id=p_crew_id and e.active
      and coalesce(e.company_id,e.organization_id)=v_company_id
  ) then raise exception 'Destination Employee is not active in this company.'; end if;

  select coalesce(array_agg(distinct u.job_id),'{}'::uuid[]) into v_job_ids
  from unnest(coalesce(p_job_ids,'{}'::uuid[])) as u(job_id);
  if cardinality(v_job_ids)=0 then raise exception 'Select at least one Customer Job.'; end if;

  if exists(
    select 1 from unnest(v_job_ids) as u(job_id)
    left join public.jobs j on j.id=u.job_id
    where j.id is null or not j.active
      or coalesce(j.company_id,j.organization_id)<>v_company_id
  ) then raise exception 'One or more Jobs are unavailable in this company.'; end if;

  -- No-date means permanent ownership. Every Visit that is still Scheduled follows
  -- the new owner, including the user's current local day. Never compare with
  -- Postgres current_date (UTC), which previously left same-day Canadian Visits behind.
  select coalesce(array_agg(v.id),'{}'::uuid[]) into v_visit_ids
  from public.visits v
  where v.job_id=any(v_job_ids)
    and v.status::text='scheduled'
    and coalesce(v.company_id,v.organization_id)=v_company_id;

  select coalesce(array_agg(distinct v.route_id),'{}'::uuid[]) into v_source_routes
  from public.visits v
  where v.id=any(v_visit_ids) and v.route_id is not null
    and coalesce(v.company_id,v.organization_id)=v_company_id;

  perform set_config('damasio.canonical_route_write','1',true);
  perform set_config('damasio.visit_transition_context','client_transfer_without_date',true);
  set constraints visits_route_order_unique deferred;

  delete from public.route_stops rs
  using public.visits v
  where rs.visit_id=v.id and v.id=any(v_visit_ids)
    and coalesce(v.company_id,v.organization_id)=v_company_id;

  update public.visits v
  set assigned_employee_id=p_employee_id,
      crew_id=p_crew_id,
      route_id=null,
      route_order=null
  where v.id=any(v_visit_ids)
    and v.status::text='scheduled'
    and coalesce(v.company_id,v.organization_id)=v_company_id;
  get diagnostics v_moved_visits=row_count;

  update public.jobs j
  set default_crew_id=p_crew_id
  where j.id=any(v_job_ids)
    and j.active
    and coalesce(j.company_id,j.organization_id)=v_company_id;
  get diagnostics v_moved_jobs=row_count;

  foreach v_route_id in array v_source_routes loop
    perform public.sync_canonical_route_stops_v2(v_route_id,'client_transfer_without_date');
  end loop;

  return jsonb_build_object(
    'saved',true,
    'mode','client_transfer',
    'jobCount',v_moved_jobs,
    'scheduledVisitsReassigned',v_moved_visits,
    'detachedFromOldRoutes',cardinality(v_source_routes),
    'needsRoutePlacement',true
  );
end;
$$;

revoke all on function public.transfer_customer_jobs_without_date(uuid[],uuid,uuid) from public,anon;
grant execute on function public.transfer_customer_jobs_without_date(uuid[],uuid,uuid) to authenticated,service_role;
notify pgrst,'reload schema';

commit;
