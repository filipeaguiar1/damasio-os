begin;

-- QA-only cleanup primitive for Operational Simulator Visits.
-- It refuses any Customer that is not one of the generated ops-sim accounts,
-- then performs the Visit delete under the same canonical writer contexts used
-- by protected route mutations. This prevents accumulated simulator residue
-- without weakening production route guards.
create or replace function public.cleanup_operational_simulation_visits(
  p_company_id uuid,
  p_customer_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer := coalesce(cardinality(p_customer_ids), 0);
  v_valid_count integer := 0;
  v_visit_ids uuid[] := '{}'::uuid[];
  v_deleted_count integer := 0;
begin
  if p_company_id is null then
    raise exception 'Operational simulator cleanup requires a company.';
  end if;

  if v_requested_count = 0 then
    return jsonb_build_object('deleted', true, 'visitCount', 0);
  end if;

  if (
    select count(distinct value)
    from unnest(p_customer_ids) value
  ) <> v_requested_count then
    raise exception 'Operational simulator cleanup received duplicate Customer IDs.';
  end if;

  select count(*)
  into v_valid_count
  from public.customers c
  where c.id = any(p_customer_ids)
    and coalesce(c.company_id, c.organization_id) = p_company_id
    and lower(coalesce(c.email, '')) like lower(
      'ops-sim-' || left(p_company_id::text, 8) || '-%@4everseasons.test'
    );

  if v_valid_count <> v_requested_count then
    raise exception 'Operational simulator cleanup refused non-simulation Customers.';
  end if;

  perform set_config('statement_timeout', '120s', true);
  perform set_config('damasio.canonical_route_write', '1', true);
  perform set_config('damasio.visit_transition_context', 'operational_simulator_cleanup', true);

  select coalesce(array_agg(v.id), '{}'::uuid[])
  into v_visit_ids
  from public.visits v
  where v.customer_id = any(p_customer_ids)
    and coalesce(v.company_id, v.organization_id) = p_company_id;

  if cardinality(v_visit_ids) = 0 then
    return jsonb_build_object('deleted', true, 'visitCount', 0);
  end if;

  -- These audit tables intentionally use ON DELETE RESTRICT. Simulator rows may
  -- touch them during route QA, so remove only audit entries for the verified
  -- simulator Visit IDs before deleting the Visits themselves.
  if to_regclass('public.visit_assignment_audit') is not null then
    execute 'delete from public.visit_assignment_audit where visit_id = any($1)'
      using v_visit_ids;
  end if;

  if to_regclass('public.visit_route_removal_audit') is not null then
    execute 'delete from public.visit_route_removal_audit where visit_id = any($1)'
      using v_visit_ids;
  end if;

  delete from public.visits v
  where v.id = any(v_visit_ids)
    and coalesce(v.company_id, v.organization_id) = p_company_id;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> cardinality(v_visit_ids) then
    raise exception 'Operational simulator Visit cleanup was incomplete: expected %, deleted %.',
      cardinality(v_visit_ids), v_deleted_count;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'visitCount', v_deleted_count
  );
end;
$$;

revoke all on function public.cleanup_operational_simulation_visits(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.cleanup_operational_simulation_visits(uuid, uuid[])
to service_role;

notify pgrst, 'reload schema';

commit;
