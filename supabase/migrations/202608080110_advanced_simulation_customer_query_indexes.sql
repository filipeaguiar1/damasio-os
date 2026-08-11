begin;

-- Advanced Simulation V2 / customer-scoped operational query reinforcement.
-- These indexes are intentionally idempotent. Some QA databases were created
-- before the customer portal index rollout, while Advanced Simulation cleanup
-- and reconciliation must remain bounded as Visit history grows.

create index if not exists visits_customer_id_scheduled_created_idx
  on public.visits (customer_id, scheduled_date desc, created_at desc)
  where customer_id is not null;

create index if not exists visits_customer_id_route_idx
  on public.visits (customer_id, route_id)
  where customer_id is not null;

create index if not exists invoices_customer_id_created_idx
  on public.invoices (customer_id, created_at desc)
  where customer_id is not null;

create index if not exists jobs_customer_id_active_idx
  on public.jobs (customer_id, active)
  where customer_id is not null;

create index if not exists photos_property_id_idx
  on public.photos (property_id)
  where property_id is not null;

analyze public.visits;
analyze public.invoices;
analyze public.jobs;
analyze public.photos;

notify pgrst, 'reload schema';

commit;
