-- Drop the non-unique route_stops.visit_id index.
-- route_stops_visit_unique remains in place and covers the same lookup while enforcing uniqueness.
-- Applied online in QA with DROP INDEX CONCURRENTLY before this migration was committed.
drop index concurrently if exists public.route_stops_visit_idx;
