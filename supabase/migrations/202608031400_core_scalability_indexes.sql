begin;

-- Damasio OS — tenant-aware operational indexes.
-- Safe across mixed installations: every index is created only when the
-- required table and columns exist. This avoids failed deployments while the
-- company_id compatibility rollout is still in progress.

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('customers_company_created_idx', 'customers', array['company_id','created_at'], 'create index customers_company_created_idx on public.customers (company_id, created_at desc) where company_id is not null'),
      ('customers_organization_created_idx', 'customers', array['organization_id','created_at'], 'create index customers_organization_created_idx on public.customers (organization_id, created_at desc) where organization_id is not null'),
      ('customers_company_full_name_idx', 'customers', array['company_id','full_name'], 'create index customers_company_full_name_idx on public.customers (company_id, lower(full_name)) where company_id is not null'),
      ('properties_company_customer_idx', 'properties', array['company_id','customer_id'], 'create index properties_company_customer_idx on public.properties (company_id, customer_id) where company_id is not null'),
      ('properties_organization_customer_idx', 'properties', array['organization_id','customer_id'], 'create index properties_organization_customer_idx on public.properties (organization_id, customer_id) where organization_id is not null'),
      ('properties_company_address_idx', 'properties', array['company_id','address_line1'], 'create index properties_company_address_idx on public.properties (company_id, lower(address_line1)) where company_id is not null'),
      ('jobs_company_active_employee_idx', 'jobs', array['company_id','active','assigned_employee_id'], 'create index jobs_company_active_employee_idx on public.jobs (company_id, active, assigned_employee_id) where company_id is not null'),
      ('jobs_organization_active_employee_idx', 'jobs', array['organization_id','active','assigned_employee_id'], 'create index jobs_organization_active_employee_idx on public.jobs (organization_id, active, assigned_employee_id) where organization_id is not null'),
      ('jobs_company_customer_active_idx', 'jobs', array['company_id','customer_id','active'], 'create index jobs_company_customer_active_idx on public.jobs (company_id, customer_id, active) where company_id is not null'),
      ('jobs_company_property_active_idx', 'jobs', array['company_id','property_id','active'], 'create index jobs_company_property_active_idx on public.jobs (company_id, property_id, active) where company_id is not null'),
      ('visits_company_date_status_idx', 'visits', array['company_id','scheduled_date','status'], 'create index visits_company_date_status_idx on public.visits (company_id, scheduled_date, status) where company_id is not null'),
      ('visits_organization_date_status_idx', 'visits', array['organization_id','scheduled_date','status'], 'create index visits_organization_date_status_idx on public.visits (organization_id, scheduled_date, status) where organization_id is not null'),
      ('visits_company_employee_date_status_idx', 'visits', array['company_id','assigned_employee_id','scheduled_date','status'], 'create index visits_company_employee_date_status_idx on public.visits (company_id, assigned_employee_id, scheduled_date, status) where company_id is not null'),
      ('visits_company_crew_date_status_idx', 'visits', array['company_id','crew_id','scheduled_date','status'], 'create index visits_company_crew_date_status_idx on public.visits (company_id, crew_id, scheduled_date, status) where company_id is not null'),
      ('visits_route_order_live_idx', 'visits', array['route_id','route_order','status'], 'create index visits_route_order_live_idx on public.visits (route_id, route_order) where route_id is not null and status <> ''cancelled'''),
      ('visits_company_job_date_live_idx', 'visits', array['company_id','job_id','scheduled_date','status'], 'create index visits_company_job_date_live_idx on public.visits (company_id, job_id, scheduled_date) where company_id is not null and status <> ''cancelled'''),
      ('route_stops_route_position_idx', 'route_stops', array['route_id','position'], 'create index route_stops_route_position_idx on public.route_stops (route_id, position)'),
      ('route_stops_visit_idx', 'route_stops', array['visit_id'], 'create index route_stops_visit_idx on public.route_stops (visit_id)'),
      ('routes_company_date_crew_idx', 'routes', array['company_id','route_date','crew_id'], 'create index routes_company_date_crew_idx on public.routes (company_id, route_date, crew_id) where company_id is not null'),
      ('routes_organization_date_crew_idx', 'routes', array['organization_id','route_date','crew_id'], 'create index routes_organization_date_crew_idx on public.routes (organization_id, route_date, crew_id) where organization_id is not null'),
      ('tasks_company_status_employee_idx', 'tasks', array['company_id','status','assigned_employee_id'], 'create index tasks_company_status_employee_idx on public.tasks (company_id, status, assigned_employee_id) where company_id is not null'),
      ('tasks_organization_status_employee_idx', 'tasks', array['organization_id','status','assigned_employee_id'], 'create index tasks_organization_status_employee_idx on public.tasks (organization_id, status, assigned_employee_id) where organization_id is not null'),
      ('invoices_company_status_created_idx', 'invoices', array['company_id','status','created_at'], 'create index invoices_company_status_created_idx on public.invoices (company_id, status, created_at desc) where company_id is not null'),
      ('invoices_organization_status_created_idx', 'invoices', array['organization_id','status','created_at'], 'create index invoices_organization_status_created_idx on public.invoices (organization_id, status, created_at desc) where organization_id is not null'),
      ('payments_company_status_created_idx', 'payments', array['company_id','status','created_at'], 'create index payments_company_status_created_idx on public.payments (company_id, status, created_at desc) where company_id is not null'),
      ('payments_organization_status_created_idx', 'payments', array['organization_id','status','created_at'], 'create index payments_organization_status_created_idx on public.payments (organization_id, status, created_at desc) where organization_id is not null'),
      ('activity_log_company_created_idx', 'activity_log', array['company_id','created_at'], 'create index activity_log_company_created_idx on public.activity_log (company_id, created_at desc) where company_id is not null'),
      ('activity_log_organization_created_idx', 'activity_log', array['organization_id','created_at'], 'create index activity_log_organization_created_idx on public.activity_log (organization_id, created_at desc) where organization_id is not null')
    ) as definitions(index_name, table_name, required_columns, statement)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null
       and not exists (
         select 1 from pg_indexes
         where schemaname = 'public' and indexname = item.index_name
       )
       and not exists (
         select 1
         from unnest(item.required_columns) as required(column_name)
         where not exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'public'
             and c.table_name = item.table_name
             and c.column_name = required.column_name
         )
       ) then
      execute item.statement;
    end if;
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers','properties','jobs','visits','route_stops','routes',
    'tasks','invoices','payments','activity_log'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('analyze public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
