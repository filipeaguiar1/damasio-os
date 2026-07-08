-- Damasio OS V41.2 - Database First Setup
-- Run this single file in Supabase SQL Editor for local/dev setup.
-- Safe to run more than once. It creates core tables, policies, storage buckets and demo data.

-- Damasio OS V41 - Supabase Database Foundation
-- Run in Supabase SQL Editor, in this order:
-- 01_schema.sql -> 02_rls_policies.sql -> 03_seed_demo.sql

create extension if not exists pgcrypto;

do $$ begin create type app_role as enum ('admin', 'employee', 'customer'); exception when duplicate_object then null; end $$;
do $$ begin create type service_frequency as enum ('weekly', 'biweekly', 'monthly', 'adaptive', 'one_time'); exception when duplicate_object then null; end $$;
do $$ begin create type task_status as enum ('open', 'assigned', 'in_progress', 'returned_to_admin', 'resolved', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type task_priority as enum ('low', 'normal', 'urgent'); exception when duplicate_object then null; end $$;
do $$ begin create type visit_status as enum ('scheduled', 'on_the_way', 'in_progress', 'completed', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type quote_status as enum ('draft', 'sent', 'approved', 'declined', 'expired'); exception when duplicate_object then null; end $$;
do $$ begin create type invoice_status as enum ('draft', 'sent', 'waiting_payment', 'processing', 'paid', 'overdue', 'rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_status as enum ('pending', 'processing', 'paid', 'failed', 'refunded', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_method as enum ('credit_card', 'etransfer', 'cash_visit', 'cheque_visit', 'other'); exception when duplicate_object then null; end $$;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  role app_role not null default 'customer',
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  crew_id uuid references crews(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  official_photo_url text,
  address_line1 text not null,
  city text not null default 'Hamilton',
  province text not null default 'ON',
  postal_code text,
  country text not null default 'Canada',
  lot_size text check (lot_size in ('xs','small','legacy','oversize')),
  grass_height text check (grass_height in ('2in','3in','4in','5in')),
  gate boolean not null default false,
  dog boolean not null default false,
  irrigation boolean not null default false,
  access_notes text,
  property_notes text,
  created_at timestamptz not null default now()
);

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  service_name text not null,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  request_id uuid references service_requests(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  quote_number text not null,
  status quote_status not null default 'draft',
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  quote_id uuid references quotes(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  invoice_number text not null,
  status invoice_status not null default 'draft',
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  method payment_method not null default 'etransfer',
  status payment_status not null default 'pending',
  amount numeric(10,2) not null default 0,
  reference text,
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  quote_id uuid references quotes(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  service_name text not null,
  frequency service_frequency not null default 'one_time',
  active boolean not null default true,
  next_visit_date date,
  created_at timestamptz not null default now()
);

create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  crew_id uuid references crews(id) on delete set null,
  route_date date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  route_id uuid references routes(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  crew_id uuid references crews(id) on delete set null,
  assigned_employee_id uuid references employees(id) on delete set null,
  scheduled_date date not null,
  status visit_status not null default 'scheduled',
  started_at timestamptz,
  finished_at timestamptz,
  duration_seconds integer,
  employee_notes text,
  customer_visible_summary text,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  source_visit_id uuid references visits(id) on delete set null,
  return_visit_id uuid references visits(id) on delete set null,
  assigned_employee_id uuid references employees(id) on delete set null,
  assigned_crew_id uuid references crews(id) on delete set null,
  title text not null,
  customer_issue text not null,
  priority task_priority not null default 'normal',
  status task_status not null default 'open',
  scheduled_date date,
  assigned_at timestamptz,
  returned_at timestamptz,
  resolved_at timestamptz,
  completion_summary text,
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  visit_id uuid references visits(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  uploaded_by uuid references profiles(id) on delete set null,
  storage_path text not null,
  public_url text,
  photo_type text check (photo_type in ('property','before','after','issue','completion')) default 'property',
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  visit_id uuid references visits(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  rating integer check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_profile_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_org_role on profiles(organization_id, role);
create index if not exists idx_properties_customer on properties(customer_id);
create index if not exists idx_tasks_status on tasks(organization_id, status);
create index if not exists idx_tasks_employee on tasks(assigned_employee_id, status);
create index if not exists idx_visits_employee on visits(assigned_employee_id, scheduled_date);
create index if not exists idx_visits_crew on visits(crew_id, scheduled_date);

insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true), ('work-photos', 'work-photos', true)
on conflict (id) do nothing;

-- -----------------------------
-- RLS policies
-- -----------------------------
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
drop policy if exists org_admin_all on organizations;
create policy org_admin_all on organizations for all using (id = app_org_id() and is_admin()) with check (id = app_org_id() and is_admin());
drop policy if exists profiles_own on profiles;
create policy profiles_own on profiles for select using (id = auth.uid());
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());

drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists customers_customer_own on customers;
create policy customers_customer_own on customers for select using (id = my_customer_id());

drop policy if exists crews_admin_all on crews;
create policy crews_admin_all on crews for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists crews_employee_own on crews;
create policy crews_employee_own on crews for select using (id = my_crew_id());

drop policy if exists employees_admin_all on employees;
create policy employees_admin_all on employees for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists employees_self on employees;
create policy employees_self on employees for select using (profile_id = auth.uid());

drop policy if exists properties_admin_all on properties;
create policy properties_admin_all on properties for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists properties_customer_own on properties;
create policy properties_customer_own on properties for select using (customer_id = my_customer_id());
drop policy if exists properties_employee_assigned on properties;
create policy properties_employee_assigned on properties for select using (
  is_employee() and exists (
    select 1 from visits v where v.property_id = properties.id and (v.assigned_employee_id = my_employee_id() or v.crew_id = my_crew_id())
  )
);

drop policy if exists requests_admin_all on service_requests;
create policy requests_admin_all on service_requests for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists requests_customer_own on service_requests;
create policy requests_customer_own on service_requests for select using (customer_id = my_customer_id());
drop policy if exists requests_customer_insert on service_requests;
create policy requests_customer_insert on service_requests for insert with check (organization_id = app_org_id() and customer_id = my_customer_id());

drop policy if exists quotes_admin_all on quotes;
create policy quotes_admin_all on quotes for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists quotes_customer_own on quotes;
create policy quotes_customer_own on quotes for select using (customer_id = my_customer_id());

-- Finance is admin/customer only. Employees have no policy here.
drop policy if exists invoices_admin_all on invoices;
create policy invoices_admin_all on invoices for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists invoices_customer_own on invoices;
create policy invoices_customer_own on invoices for select using (customer_id = my_customer_id());
drop policy if exists payments_admin_all on payments;
create policy payments_admin_all on payments for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists payments_customer_own on payments;
create policy payments_customer_own on payments for select using (customer_id = my_customer_id());

drop policy if exists jobs_admin_all on jobs;
create policy jobs_admin_all on jobs for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists jobs_customer_own on jobs;
create policy jobs_customer_own on jobs for select using (customer_id = my_customer_id());
drop policy if exists jobs_employee_assigned on jobs;
create policy jobs_employee_assigned on jobs for select using (
  is_employee() and exists (
    select 1 from visits v where v.job_id = jobs.id and (v.assigned_employee_id = my_employee_id() or v.crew_id = my_crew_id())
  )
);

drop policy if exists routes_admin_all on routes;
create policy routes_admin_all on routes for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists routes_employee_own on routes;
create policy routes_employee_own on routes for select using (crew_id = my_crew_id());

drop policy if exists visits_admin_all on visits;
create policy visits_admin_all on visits for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists visits_customer_own on visits;
create policy visits_customer_own on visits for select using (customer_id = my_customer_id());
drop policy if exists visits_employee_own_select on visits;
create policy visits_employee_own_select on visits for select using (assigned_employee_id = my_employee_id() or crew_id = my_crew_id());
drop policy if exists visits_employee_update_work on visits;
create policy visits_employee_update_work on visits for update using (assigned_employee_id = my_employee_id() or crew_id = my_crew_id()) with check (assigned_employee_id = my_employee_id() or crew_id = my_crew_id());

drop policy if exists tasks_admin_all on tasks;
create policy tasks_admin_all on tasks for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists tasks_customer_own on tasks;
create policy tasks_customer_own on tasks for select using (customer_id = my_customer_id());
drop policy if exists tasks_customer_insert on tasks;
create policy tasks_customer_insert on tasks for insert with check (organization_id = app_org_id() and customer_id = my_customer_id());
drop policy if exists tasks_employee_assigned_select on tasks;
create policy tasks_employee_assigned_select on tasks for select using (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id());
drop policy if exists tasks_employee_update_assigned on tasks;
create policy tasks_employee_update_assigned on tasks for update using (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id()) with check (assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id());

drop policy if exists photos_admin_all on photos;
create policy photos_admin_all on photos for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists photos_customer_own on photos;
create policy photos_customer_own on photos for select using (
  property_id in (select id from properties where customer_id = my_customer_id())
);
drop policy if exists photos_employee_assigned on photos;
create policy photos_employee_assigned on photos for all using (
  is_employee() and (
    visit_id in (select id from visits where assigned_employee_id = my_employee_id() or crew_id = my_crew_id())
    or task_id in (select id from tasks where assigned_employee_id = my_employee_id() or assigned_crew_id = my_crew_id())
  )
) with check (organization_id = app_org_id());

drop policy if exists feedback_admin_all on feedback;
create policy feedback_admin_all on feedback for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists feedback_customer_own on feedback;
create policy feedback_customer_own on feedback for all using (customer_id = my_customer_id()) with check (customer_id = my_customer_id());

drop policy if exists activity_admin_all on activity_log;
create policy activity_admin_all on activity_log for all using (organization_id = app_org_id() and is_admin()) with check (organization_id = app_org_id() and is_admin());
drop policy if exists activity_employee_read_own on activity_log;
create policy activity_employee_read_own on activity_log for select using (actor_profile_id = auth.uid() and is_employee());

-- Storage policies
drop policy if exists property_photos_public_read on storage.objects;
create policy property_photos_public_read on storage.objects for select using (bucket_id = 'property-photos');
drop policy if exists work_photos_public_read on storage.objects;
create policy work_photos_public_read on storage.objects for select using (bucket_id = 'work-photos');
drop policy if exists authenticated_upload_property_photos on storage.objects;
create policy authenticated_upload_property_photos on storage.objects for insert to authenticated with check (bucket_id = 'property-photos');
drop policy if exists authenticated_upload_work_photos on storage.objects;
create policy authenticated_upload_work_photos on storage.objects for insert to authenticated with check (bucket_id = 'work-photos');

-- -----------------------------
-- Demo seed data
-- -----------------------------
-- Demo seed without auth users. Use this to confirm tables, UI mapping and relationships.
insert into organizations (id, name, slug) values
('00000000-0000-0000-0000-000000000001', 'Damasio Seasons', 'damasio-seasons')
on conflict do nothing;

insert into customers (id, organization_id, full_name, email, phone) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Customer Demo','customer@email.com','905-555-0101'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','John Smith','john@email.com','905-555-0102'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Maria Costa','maria@email.com','905-555-0103')
on conflict do nothing;

insert into crews (id, organization_id, name) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Crew A'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Crew B')
on conflict do nothing;

insert into employees (id, organization_id, crew_id, full_name, email) values
('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Filipe','employee@demo.com'),
('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Crew B Worker','workerb@demo.com')
on conflict do nothing;

insert into properties (id, organization_id, customer_id, address_line1, city, province, lot_size, grass_height, gate, dog, irrigation, access_notes) values
('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','123 King St','Hamilton','ON','small','3in',true,false,false,'Gate on left side.'),
('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','123 King St','Hamilton','ON','legacy','3in',false,false,false,'Side strip near fence.'),
('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','45 Lakeshore','Hamilton','ON','small','2in',false,true,false,'Dog may be outside.')
on conflict do nothing;

insert into tasks (id, organization_id, customer_id, property_id, assigned_employee_id, assigned_crew_id, title, customer_issue, priority, status, scheduled_date, assigned_at) values
('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Return visit required','Customer said side strip near fence was missed.','urgent','assigned',current_date,now()),
('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003',null,null,'Blow driveway again','Customer reported clippings left on driveway.','normal','open',null,null)
on conflict (id) do nothing;

-- -----------------------------
-- V42.0 database health check
-- -----------------------------
-- This function lets the app verify the database foundation from Admin → Database
-- without requiring company signup or real auth during the early database sprint.
insert into storage.buckets (id, name, public)
values
  ('task-photos', 'task-photos', true),
  ('before-after', 'before-after', true),
  ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists task_photos_public_read on storage.objects;
create policy task_photos_public_read on storage.objects for select using (bucket_id = 'task-photos');
drop policy if exists before_after_public_read on storage.objects;
create policy before_after_public_read on storage.objects for select using (bucket_id = 'before-after');
drop policy if exists authenticated_upload_task_photos on storage.objects;
create policy authenticated_upload_task_photos on storage.objects for insert to authenticated with check (bucket_id = 'task-photos');
drop policy if exists authenticated_upload_before_after on storage.objects;
create policy authenticated_upload_before_after on storage.objects for insert to authenticated with check (bucket_id = 'before-after');
drop policy if exists authenticated_documents_access on storage.objects;
create policy authenticated_documents_access on storage.objects for all to authenticated using (bucket_id = 'documents') with check (bucket_id = 'documents');

create or replace function public.database_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_names text[] := array[
    'organizations','profiles','customers','employees','crews','properties',
    'service_requests','quotes','invoices','payments','jobs','routes','visits',
    'tasks','photos','feedback','activity_log'
  ];
  check_table_name text;
  table_exists boolean;
  row_count integer;
  checks jsonb := '[]'::jsonb;
begin
  foreach check_table_name in array table_names loop
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = check_table_name
    ) into table_exists;

    if table_exists then
      execute format('select count(*) from public.%I', check_table_name) into row_count;
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

  return jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'tables', checks
  );
end;
$$;

grant execute on function public.database_health_check() to anon, authenticated;

create or replace function public.storage_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  bucket_names text[] := array['property-photos','work-photos','task-photos','before-after','documents'];
  check_bucket_name text;
  bucket_exists boolean;
  checks jsonb := '[]'::jsonb;
begin
  foreach check_bucket_name in array bucket_names loop
    select exists (select 1 from storage.buckets where id = check_bucket_name) into bucket_exists;
    checks := checks || jsonb_build_object('bucket', check_bucket_name, 'exists', bucket_exists);
  end loop;

  return jsonb_build_object(
    'ok', not exists (
      select 1 from unnest(bucket_names) as required_bucket
      where not exists (select 1 from storage.buckets where id = required_bucket)
    ),
    'checked_at', now(),
    'buckets', checks
  );
end;
$$;

grant execute on function public.storage_health_check() to anon, authenticated;

