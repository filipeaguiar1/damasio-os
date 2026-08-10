begin;

-- Canonical employee and route lookups.
create index if not exists employees_profile_id_idx
  on public.employees (profile_id)
  where profile_id is not null;
create index if not exists employees_crew_id_idx
  on public.employees (crew_id)
  where crew_id is not null;
create index if not exists routes_crew_id_idx
  on public.routes (crew_id)
  where crew_id is not null;

-- Customer → Property → Quote → Job lookup chain.
create index if not exists quotes_customer_id_idx
  on public.quotes (customer_id)
  where customer_id is not null;
create index if not exists quotes_property_id_idx
  on public.quotes (property_id)
  where property_id is not null;
create index if not exists jobs_property_id_idx
  on public.jobs (property_id)
  where property_id is not null;
create index if not exists jobs_quote_id_idx
  on public.jobs (quote_id)
  where quote_id is not null;
create index if not exists jobs_invoice_id_idx
  on public.jobs (invoice_id)
  where invoice_id is not null;

-- Visit and billing reconciliation lookups.
create index if not exists visits_job_id_idx
  on public.visits (job_id)
  where job_id is not null;
create index if not exists visits_property_id_idx
  on public.visits (property_id)
  where property_id is not null;
create index if not exists invoices_property_id_idx
  on public.invoices (property_id)
  where property_id is not null;
create index if not exists invoices_quote_id_idx
  on public.invoices (quote_id)
  where quote_id is not null;

-- Remove only verified non-constraint duplicates whose equivalent index is active.
drop index if exists public.customers_company_offer_status_idx;
drop index if exists public.idx_jobs_company_id_compat;
drop index if exists public.idx_quotes_company_id_compat;

commit;
