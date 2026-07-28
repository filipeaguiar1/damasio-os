begin;

-- Compatibility guard: every older caller of publish_canonical_route now uses
-- the dated-Visit publisher and can no longer change permanent Job ownership.
create or replace function public.publish_canonical_route(
  p_employee_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_ordered_job_ids uuid[],
  p_source_visit_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.publish_canonical_route_daily(
    p_employee_id,
    p_crew_id,
    p_route_date,
    p_ordered_job_ids,
    p_source_visit_ids
  )
$$;

revoke all
on function public.publish_canonical_route(uuid,uuid,date,uuid[],uuid[])
from public, anon;

grant execute
on function public.publish_canonical_route(uuid,uuid,date,uuid[],uuid[])
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
