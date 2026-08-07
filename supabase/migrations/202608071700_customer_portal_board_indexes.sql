-- Customer Portal board is customer-scoped and aggregates visits/tasks/requests/quotes/feedback.
-- Keep these reads bounded as QA/history volume grows.
begin;

create index if not exists visits_customer_id_scheduled_created_idx
  on public.visits (customer_id, scheduled_date desc, created_at desc)
  where customer_id is not null;

create index if not exists tasks_customer_id_created_idx
  on public.tasks (customer_id, created_at desc)
  where customer_id is not null;

create index if not exists service_requests_customer_id_created_idx
  on public.service_requests (customer_id, created_at desc)
  where customer_id is not null;

create index if not exists quotes_customer_id_created_idx
  on public.quotes (customer_id, created_at desc)
  where customer_id is not null;

create index if not exists feedback_customer_id_created_idx
  on public.feedback (customer_id, created_at desc)
  where customer_id is not null;

create index if not exists properties_customer_id_created_idx
  on public.properties (customer_id, created_at)
  where customer_id is not null;

commit;
