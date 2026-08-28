-- Employee mobile/web no longer uses this legacy RPC.
-- The canonical Employee Route is served by /api/mobile/employee/route using
-- visits + route_stops, with route_stops as the official ordering source.
-- Keep the legacy function unavailable to browser sessions so it cannot become
-- a second route read path.

begin;

revoke execute on function public.get_employee_route_for_date(date)
  from public, anon, authenticated;
grant execute on function public.get_employee_route_for_date(date)
  to service_role;

commit;
