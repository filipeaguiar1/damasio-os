-- These browser-facing compatibility writers are no longer used by the current
-- application. Employee execution uses transition_visit_execution and Employee
-- Smart Route uses the canonical service writer through the server API.

begin;

revoke execute on function public.set_visit_dispatch_status(uuid,text)
  from public,anon,authenticated;
grant execute on function public.set_visit_dispatch_status(uuid,text)
  to service_role;

revoke execute on function public.apply_employee_smart_route(uuid,uuid[],uuid[],text,double precision,double precision,integer)
  from public,anon,authenticated;
grant execute on function public.apply_employee_smart_route(uuid,uuid[],uuid[],text,double precision,double precision,integer)
  to service_role;

revoke execute on function public.restore_employee_smart_route(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.restore_employee_smart_route(uuid,integer)
  to service_role;

commit;
