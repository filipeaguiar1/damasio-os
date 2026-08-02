begin;

-- Refuse to start the structural migration on an unexpected production schema.
-- This block is read-only; any missing dependency aborts before Route Stops V2
-- creates or changes operational data.
do $$
declare
  v_missing text[] := '{}'::text[];
  v_constraint record;
begin
  if to_regclass('public.organizations') is null then v_missing := array_append(v_missing, 'table public.organizations'); end if;
  if to_regclass('public.routes') is null then v_missing := array_append(v_missing, 'table public.routes'); end if;
  if to_regclass('public.visits') is null then v_missing := array_append(v_missing, 'table public.visits'); end if;
  if to_regclass('public.jobs') is null then v_missing := array_append(v_missing, 'table public.jobs'); end if;
  if to_regclass('public.profiles') is null then v_missing := array_append(v_missing, 'table public.profiles'); end if;
  if to_regclass('public.employees') is null then v_missing := array_append(v_missing, 'table public.employees'); end if;
  if to_regclass('public.crews') is null then v_missing := array_append(v_missing, 'table public.crews'); end if;
  if to_regclass('public.employee_smart_route_state') is null then v_missing := array_append(v_missing, 'table public.employee_smart_route_state'); end if;
  if to_regclass('public.activity_log') is null then v_missing := array_append(v_missing, 'table public.activity_log'); end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='routes' and column_name='company_id') then v_missing := array_append(v_missing, 'column routes.company_id'); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='routes' and column_name='organization_id') then v_missing := array_append(v_missing, 'column routes.organization_id'); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='routes' and column_name='crew_id') then v_missing := array_append(v_missing, 'column routes.crew_id'); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='routes' and column_name='route_date') then v_missing := array_append(v_missing, 'column routes.route_date'); end if;

  for v_constraint in
    select required.column_name
    from (values
      ('id'),('route_id'),('job_id'),('customer_id'),('property_id'),
      ('crew_id'),('assigned_employee_id'),('scheduled_date'),('status'),
      ('route_order'),('created_at'),('company_id'),('organization_id')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name='visits'
        and c.column_name=required.column_name
    )
  loop
    v_missing := array_append(v_missing, 'column visits.' || v_constraint.column_name);
  end loop;

  for v_constraint in
    select required.column_name
    from (values
      ('route_id'),('company_id'),('crew_id'),('route_date'),
      ('original_order'),('applied_order'),('origin_label'),
      ('origin_latitude'),('origin_longitude'),('active'),
      ('applied_by_profile_id'),('applied_at'),('route_version'),('updated_at')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name='employee_smart_route_state'
        and c.column_name=required.column_name
    )
  loop
    v_missing := array_append(v_missing, 'column employee_smart_route_state.' || v_constraint.column_name);
  end loop;

  if to_regprocedure('public.current_company_id()') is null then
    v_missing := array_append(v_missing, 'function current_company_id()');
  end if;
  if to_regprocedure('public.master_has_company_access(uuid,text)') is null then
    v_missing := array_append(v_missing, 'function master_has_company_access(uuid,text)');
  end if;
  if to_regprocedure('public.employee_can_use_route(uuid)') is null then
    v_missing := array_append(v_missing, 'function employee_can_use_route(uuid)');
  end if;
  if to_regprocedure('public.publish_canonical_route_daily(uuid,uuid,date,uuid[],uuid[])') is null then
    v_missing := array_append(v_missing, 'function publish_canonical_route_daily(uuid,uuid,date,uuid[],uuid[])');
  end if;
  if to_regprocedure('public.move_canonical_visits(uuid[],uuid,uuid,text)') is null then
    v_missing := array_append(v_missing, 'function move_canonical_visits(uuid[],uuid,uuid,text)');
  end if;

  select conname, condeferrable, condeferred
  into v_constraint
  from pg_constraint
  where conrelid='public.visits'::regclass
    and conname='visits_route_order_unique';

  if not found then
    v_missing := array_append(v_missing, 'constraint visits_route_order_unique');
  elsif not v_constraint.condeferrable or not v_constraint.condeferred then
    v_missing := array_append(v_missing, 'visits_route_order_unique must be DEFERRABLE INITIALLY DEFERRED');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'Canonical Route Stops V2 preflight failed: %', array_to_string(v_missing, ', ');
  end if;
end
$$;

commit;
