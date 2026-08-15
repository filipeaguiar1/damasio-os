create or replace function public.database_health_check()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  table_names text[] := array[
    'organizations','profiles','customers','employees','crews','properties',
    'service_requests','quotes','invoices','payments','jobs','routes','visits',
    'tasks','photos','feedback','activity_log','employee_smart_route_state'
  ];
  check_table_name text;
  table_exists boolean;
  row_count integer;
  checks jsonb := '[]'::jsonb;
  v_role text;
  v_company uuid;
  v_global boolean := false;
begin
  if auth.role() = 'service_role' then
    v_global := true;
  else
    select p.role::text, coalesce(p.company_id, p.organization_id)
      into v_role, v_company
    from public.profiles p
    where p.id = auth.uid()
      and p.active
    limit 1;

    if v_role not in ('admin','manager','master') then
      raise exception 'Active Admin, Manager or Master company access required';
    end if;

    if v_role = 'master' then
      v_global := true;
    elsif v_company is null then
      raise exception 'Company-scoped health check requires a company';
    end if;
  end if;

  foreach check_table_name in array table_names loop
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = check_table_name
    ) into table_exists;

    if table_exists then
      if v_global then
        execute format('select count(*) from public.%I', check_table_name) into row_count;
      elsif check_table_name = 'organizations' then
        execute 'select count(*) from public.organizations where id = $1'
          into row_count using v_company;
      elsif check_table_name = 'employee_smart_route_state' then
        execute 'select count(*) from public.employee_smart_route_state where company_id = $1'
          into row_count using v_company;
      elsif check_table_name = 'invoices' then
        execute 'select count(*) from public.invoices where organization_id = $1'
          into row_count using v_company;
      else
        execute format(
          'select count(*) from public.%I where coalesce(company_id, organization_id) = $1',
          check_table_name
        ) into row_count using v_company;
      end if;

      checks := checks || jsonb_build_object(
        'table', check_table_name,
        'exists', true,
        'visible_rows', row_count,
        'error', null
      );
    else
      checks := checks || jsonb_build_object(
        'table', check_table_name,
        'exists', false,
        'visible_rows', null,
        'error', 'Table not found'
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'checked_at', now(), 'tables', checks);
end;
$function$;

create or replace function public.route_stops_health_check()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_company uuid;
  v_global boolean := false;
  v_route_stops_count bigint;
  v_visits_missing bigint;
  v_orphan_stops bigint;
begin
  if auth.role() = 'service_role' then
    v_global := true;
  else
    select p.role::text, coalesce(p.company_id, p.organization_id)
      into v_role, v_company
    from public.profiles p
    where p.id = auth.uid()
      and p.active
    limit 1;

    if v_role not in ('admin','manager','master') then
      raise exception 'Active Admin, Manager or Master company access required';
    end if;

    if v_role = 'master' then
      v_global := true;
    elsif v_company is null then
      raise exception 'Company-scoped route health check requires a company';
    end if;
  end if;

  if v_global then
    select count(*) into v_route_stops_count from public.route_stops;
    select count(*) into v_visits_missing
    from public.visits v
    where v.route_id is not null
      and v.status <> 'cancelled'
      and not exists (
        select 1 from public.route_stops rs
        where rs.route_id = v.route_id and rs.visit_id = v.id
      );
    select count(*) into v_orphan_stops
    from public.route_stops rs
    where not exists (select 1 from public.visits v where v.id = rs.visit_id);
  else
    select count(*) into v_route_stops_count
    from public.route_stops rs
    where coalesce(rs.company_id, rs.organization_id) = v_company;

    select count(*) into v_visits_missing
    from public.visits v
    where coalesce(v.company_id, v.organization_id) = v_company
      and v.route_id is not null
      and v.status <> 'cancelled'
      and not exists (
        select 1 from public.route_stops rs
        where rs.route_id = v.route_id and rs.visit_id = v.id
      );

    select count(*) into v_orphan_stops
    from public.route_stops rs
    where coalesce(rs.company_id, rs.organization_id) = v_company
      and not exists (select 1 from public.visits v where v.id = rs.visit_id);
  end if;

  return jsonb_build_object(
    'routeStopsTable', to_regclass('public.route_stops') is not null,
    'safeQueueFunction', to_regprocedure('public.safe_queue_route_map_rebuild(uuid,uuid,text)') is not null,
    'publishFunction', to_regprocedure('public.publish_official_route_stops(uuid,date,uuid[])') is not null,
    'oldQueueReferences', coalesce((
      select jsonb_agg(p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosrc like '%queue_route_map_rebuild%'
        and p.prosrc not like '%safe_queue_route_map_rebuild%'
    ), '[]'::jsonb),
    'routeStopsCount', v_route_stops_count,
    'visitsMissingOfficialStop', v_visits_missing,
    'orphanRouteStops', v_orphan_stops
  );
end;
$function$;
