-- Damasio OS V42.6 — Performance Optimization Indexes
-- Safe to run multiple times. Focuses on filters used by Calendar, Routes, Customers and Properties.

create index if not exists idx_customers_created_at_desc on customers (created_at desc);
create index if not exists idx_customers_name_lower on customers (lower(name));
create index if not exists idx_properties_customer_id on properties (customer_id);
create index if not exists idx_properties_address_lower on properties (lower(address));
create index if not exists idx_jobs_property_status on jobs (property_id, status);
create index if not exists idx_jobs_customer_status on jobs (customer_id, status);
create index if not exists idx_visits_scheduled_date_status on visits (scheduled_date, status);
create index if not exists idx_visits_crew_date_order on visits (crew_id, scheduled_date, route_order);
create index if not exists idx_tasks_property_status_priority on tasks (property_id, status, priority);
create index if not exists idx_activity_logs_entity_created on activity_logs (entity_type, entity_id, created_at desc);
