begin;

-- Route Advisor publication changes dated Visit membership before the final
-- canonical route order is materialized. Keep that entire publication inside
-- the same canonical-writer authorization boundary used by route_stops.
create or replace function public.publish_canonical_route_daily_protected(
  p_employee_id uuid,
  p_crew_id uuid,
  p_route_date date,
  p_ordered_job_ids uuid[],
  p_source_visit_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('damasio.canonical_route_write', '1', true);

  return public.publish_canonical_route_daily(
    p_employee_id,
    p_crew_id,
    p_route_date,
    p_ordered_job_ids,
    p_source_visit_ids
  );
end;
$$;

revoke all on function public.publish_canonical_route_daily_protected(
  uuid, uuid, date, uuid[], uuid[]
) from public, anon;
grant execute on function public.publish_canonical_route_daily_protected(
  uuid, uuid, date, uuid[], uuid[]
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
