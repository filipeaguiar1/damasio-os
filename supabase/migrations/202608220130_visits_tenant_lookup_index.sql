begin;

-- Add the missing tenant-key index needed by PostgREST queries that preserve
-- compatibility with both company_id and organization_id.
-- This is additive only: it does not change route semantics, canonical order,
-- Smart Route behavior, or visits.route_order projection.
create index if not exists idx_visits_organization_identity_contract
  on public.visits(organization_id);

commit;
