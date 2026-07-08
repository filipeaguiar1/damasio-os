-- Damasio OS V41 - Supabase Database Foundation
-- Run in Supabase SQL Editor, in this order:
-- 01_schema.sql -> 02_rls_policies.sql -> 03_seed_demo.sql

create extension if not exists pgcrypto;

create type app_role as enum ('admin', 'employee', 'customer');
create type service_frequency as enum ('weekly', 'biweekly', 'monthly', 'adaptive', 'one_time');
create type task_status as enum ('open', 'assigned', 'in_progress', 'returned_to_admin', 'resolved', 'cancelled');
create type task_priority as enum ('low', 'normal', 'urgent');
create type visit_status as enum ('scheduled', 'on_the_way', 'in_progress', 'completed', 'cancelled');
create type quote_status as enum ('draft', 'sent', 'approved', 'declined', 'expired');
create type invoice_status as enum ('draft', 'sent', 'waiting_payment', 'processing', 'paid', 'overdue', 'rejected');
create type payment_status as enum ('pending', 'processing', 'paid', 'failed', 'refunded', 'manual');
create type payment_method as enum ('credit_card', 'etransfer', 'cash_visit', 'cheque_visit', 'other');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table profiles (
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

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table employees (
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

create table properties (
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

create table service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  service_name text not null,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table quotes (
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

create table invoices (
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

create table payments (
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

create table jobs (
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

create table routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  crew_id uuid references crews(id) on delete set null,
  route_date date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table visits (
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

create table tasks (
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

create table photos (
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

create table feedback (
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

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_profile_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details text,
  created_at timestamptz not null default now()
);

create index idx_profiles_org_role on profiles(organization_id, role);
create index idx_properties_customer on properties(customer_id);
create index idx_tasks_status on tasks(organization_id, status);
create index idx_tasks_employee on tasks(assigned_employee_id, status);
create index idx_visits_employee on visits(assigned_employee_id, scheduled_date);
create index idx_visits_crew on visits(crew_id, scheduled_date);

insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true), ('work-photos', 'work-photos', true)
on conflict (id) do nothing;
