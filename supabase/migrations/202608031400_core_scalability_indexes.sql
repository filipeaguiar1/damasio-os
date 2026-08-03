begin;

-- Damasio OS — tenant-aware operational indexes.
-- Safe to run repeatedly. Every index is aligned with a frequent filtered read.
-- The dual company/organization variants support the temporary compatibility
-- period without forcing broad cross-tenant scans.

create index if not exists customers_company_created_idx
  on public.customers (company_id, created_at desc)
  where company_id is not null;
create index if not exists customers_organization_created_idx
  on public.customers (organization_id, created_at desc)
  where organization_id is not null;
create index if not exists customers_company_name_idx
  on public.customers (company_id, lower(name))
  where company_id is not null;

create index if not exists properties_company_customer_idx
  on public.properties (company_id, customer_id)
  where company_id is not null;
create index if not exists properties_organization_customer_idx
  on public.properties (organization_id, customer_id)
  where organization_id is not null;
create index if not exists properties_company_address_idx
  on public.properties (company_id, lower(address))
  where company_id is not null;

create index if not exists jobs_company_active_employee_idx
  on public.jobs (company_id, active, assigned_employee_id)
  where company_id is not null;
create index if not exists jobs_organization_active_employee_idx
  on public.jobs (organization_id, active, assigned_employee_id)
  where organization_id is not null;
create index if not exists jobs_company_customer_active_idx
  on public.jobs (company_id, customer_id, active)
  where company_id is not null;
create index if not exists jobs_company_property_active_idx
  on public.jobs (company_id, property_id, active)
  where company_id is not null;

create index if not exists visits_company_date_status_idx
  on public.visits (company_id, scheduled_date, status)
  where company_id is not null;
create index if not exists visits_organization_date_status_idx
  on public.visits (organization_id, scheduled_date, status)
  where organization_id is not null;
create index if not exists visits_company_employee_date_status_idx
  on public.visits (company_id, assigned_employee_id, scheduled_date, status)
  where company_id is not null;
create index if not exists visits_company_crew_date_status_idx
  on public.visits (company_id, crew_id, scheduled_date, status)
  where company_id is not null;
create index if not exists visits_route_order_live_idx
  on public.visits (route_id, route_order)
  where route_id is not null and status <> 'cancelled';
create index if not exists visits_company_job_date_live_idx
  on public.visits (company_id, job_id, scheduled_date)
  where company_id is not null and status <> 'cancelled';

create index if not exists route_stops_route_position_idx
  on public.route_stops (route_id, position);
create index if not exists route_stops_visit_idx
  on public.route_stops (visit_id);

create index if not exists routes_company_date_crew_idx
  on public.routes (company_id, route_date, crew_id)
  where company_id is not null;
create index if not exists routes_organization_date_crew_idx
  on public.routes (organization_id, route_date, crew_id)
  where organization_id is not null;

create index if not exists tasks_company_status_assignee_idx
  on public.tasks (company_id, status, assigned_to)
  where company_id is not null;
create index if not exists tasks_organization_status_assignee_idx
  on public.tasks (organization_id, status, assigned_to)
  where organization_id is not null;

create index if not exists invoices_company_status_created_idx
  on public.invoices (company_id, status, created_at desc)
  where company_id is not null;
create index if not exists invoices_organization_status_created_idx
  on public.invoices (organization_id, status, created_at desc)
  where organization_id is not null;

create index if not exists payments_company_status_created_idx
  on public.payments (company_id, status, created_at desc)
  where company_id is not null;
create index if not exists payments_organization_status_created_idx
  on public.payments (organization_id, status, created_at desc)
  where organization_id is not null;

create index if not exists activity_logs_company_created_idx
  on public.activity_logs (company_id, created_at desc)
  where company_id is not null;
create index if not exists activity_logs_organization_created_idx
  on public.activity_logs (organization_id, created_at desc)
  where organization_id is not null;

analyze public.customers;
analyze public.properties;
analyze public.jobs;
analyze public.visits;
analyze public.route_stops;
analyze public.routes;
analyze public.tasks;
analyze public.invoices;
analyze public.payments;
analyze public.activity_logs;

commit;
