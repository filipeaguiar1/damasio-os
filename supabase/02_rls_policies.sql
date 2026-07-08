-- Damasio OS V41 - Row Level Security
-- Admin sees everything in their organization.
-- Employee sees only assigned crew/employee operational data, never finance.
-- Customer sees only their own customer/property/history data.

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table customers enable row level security;
alter table crews enable row level security;
alter table employees enable row level security;
alter table properties enable row level security;
alter table service_requests enable row level security;
alter table quotes enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table jobs enable row level security;
alter table routes enable row level security;
alter table visits enable row level security;
alter table tasks enable row level security;
alter table photos enable row level security;
alter table feedback enable row level security;
alter table activity_log enable row level security;

create or replace function app_profile()
returns profiles
language sql security definer stable
set search_path = public
as $$ select * from profiles where id = auth.uid() limit 1 $$;

create or replace function app_org_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select organization_id from profiles where id = auth.uid() limit 1 $$;

create or replace function app_role_name()
returns app_role
language sql security definer stable
set search_path = public
as $$ select role from profiles where id = auth.uid() limit 1 $$;

create or replace function is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and active = true) $$;

create or replace function is_employee()
returns boolean
language sql security definer stable
set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and role = 'employee' and active = true) $$;

create or replace function is_customer()
returns boolean
language sql security definer stable
set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and role = 'customer' and active = true) $$;

create or replace function my_employee_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select id from employees where profile_id = auth.uid() limit 1 $$;

create or replace function my_crew_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select crew_id from employees where profile_id = auth.uid() limit 1 $$;

create or replace function my_customer_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select id from customers where profile_id = auth.uid() limit 1 $$;

-- Generic organization isolation for admin tables
create policy org_admin_all on organizations for all using (id = app_org_id() and is_admin()) with check (id = app_org_id() and is_admin());
create policy profiles_own on profiles for select using (id = auth.uid());
create policy profiles_admin_all on profiles for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());

create policy customers_admin_all on customers for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy customers_customer_own on customers for select using (id = my_customer_id());

create policy crews_admin_all on crews for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy crews_employee_own on crews for select using (id = my_crew_id());

create policy employees_admin_all on employees for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy employees_self on employees for select using (profile_id = auth.uid());

create policy properties_admin_all on properties for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy properties_customer_own on properties for select using (customer_id = my_customer_id());
create policy properties_employee_assigned on properties for select using (
  is_employee() and exists (
    select 1 from visits v where v.property_id = properties.id and (v.assigned_employee_id = my_employee_id() or v.crew_id = my_crew_id())
  )
);

create policy requests_admin_all on service_requests for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy requests_customer_own on service_requests for select using (customer_id = my_customer_id());
create policy requests_customer_insert on service_requests for insert with check (organization_id = app_org_id() and customer_id = my_customer_id());

create policy quotes_admin_all on quotes for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy quotes_customer_own on quotes for select using (customer_id = my_customer_id());

-- Finance is admin/customer only. Employees have no policy here.
create policy invoices_admin_all on invoices for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy invoices_customer_own on invoices for select using (customer_id = my_customer_id());
create policy payments_admin_all on payments for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy payments_customer_own on payments for select using (customer_id = my_customer_id());

create policy jobs_admin_all on jobs for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy jobs_customer_own on jobs for select using (customer_id = my_customer_id());
create policy jobs_employee_assigned on jobs for select using (
  is_employee() and exists (
    select 1 from visits v where v.job_id = jobs.id and (v.assigned_employee_id = my_employee_id() or v.crew_id = my_crew_id())
  )
);

create policy routes_admin_all on routes for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy routes_employee_own on routes for select using (crew_id = my_crew_id());

create policy visits_admin_all on visits for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy visits_customer_own on visits for select using (customer_id = my_customer_id());
create policy visits_employee_own_select on visits for select using (assigned_employee_id = my_employee_id() or crew_id = my_crew_id());
create policy visits_employee_update_work on visits for update using (assigned_employee_id = my_employee_id() or crew_id = my_crew_id()) with check (assigned_employee_id = my_employee_id() or crew_id = my_crew_id());

create policy tasks_admin_all on tasks for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy tasks_customer_own on tasks for select using (customer_id = my_customer_id());
create policy tasks_customer_insert on tasks for insert with check (organization_id = app_org_id() and customer_id = my_customer_id());
create policy tasks_employee_assigned_select on tasks for select using (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id());
create policy tasks_employee_update_assigned on tasks for update using (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id()) with check (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id());

create policy photos_admin_all on photos for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy photos_customer_own on photos for select using (
  property_id in (select id from properties where customer_id = my_customer_id())
);
create policy photos_employee_assigned on photos for all using (
  is_employee() and (
    visit_id in (select id from visits where assigned_employee_id = my_employee_id() or crew_id = my_crew_id())
    or task_id in (select id from tasks where assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id())
  )
) with check (organization_id = app_org_id());

create policy feedback_admin_all on feedback for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy feedback_customer_own on feedback for all using (customer_id = my_customer_id()) with check (customer_id = my_customer_id());

create policy activity_admin_all on activity_log for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
create policy activity_employee_read_own on activity_log for select using (actor_profile_id = auth.uid() and is_employee());

-- Storage policies
create policy property_photos_public_read on storage.objects for select using (bucket_id = 'property-photos');
create policy work_photos_public_read on storage.objects for select using (bucket_id = 'work-photos');
create policy authenticated_upload_property_photos on storage.objects for insert to authenticated with check (bucket_id = 'property-photos');
create policy authenticated_upload_work_photos on storage.objects for insert to authenticated with check (bucket_id = 'work-photos');
