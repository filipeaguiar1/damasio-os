begin;

-- Internal trigger function only. It must not be callable through PostgREST RPC
-- by anonymous or regular authenticated clients.
revoke all on function public.project_route_stop_to_visit_order() from public;
revoke execute on function public.project_route_stop_to_visit_order() from anon, authenticated;
grant execute on function public.project_route_stop_to_visit_order() to service_role;

commit;
