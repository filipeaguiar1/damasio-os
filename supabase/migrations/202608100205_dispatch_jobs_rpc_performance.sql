begin;

-- get_company_dispatch_jobs is used by the Admin Routes read model. Under
-- concurrent simulator QA the previous SQL body could re-evaluate auth/company
-- helper functions while scanning every active Job, consuming the statement
-- timeout budget. Resolve authorization and tenant context once, then run the
-- same canonical joins/aggregation with those stable values.
create or replace function public.get_company_dispatch_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_company_id uuid;
  v_allowed boolean;
  v_result jsonb;
begin
  perform public.require_active_company_operator();

  v_allowed :=
    public.company_module_permission_allowed('dispatch', 'view')
    or public.company_module_permission_allowed('jobs', 'view');

  if not v_allowed then
    return '[]'::jsonb;
  end if;

  v_company_id := public.current_company_id();
  if v_company_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'serviceName', j.service_name,
        'frequency', j.frequency::text,
        'nextVisitDate', j.next_visit_date,
        'customerName', c.full_name,
        'address', p.address_line1,
        'propertyId', j.property_id,
        'customerId', j.customer_id,
        'quoteId', j.quote_id,
        'crewId', j.default_crew_id,
        'crewName', cr.name,
        'recurrenceAnchorDate', j.recurrence_anchor_date,
        'defaultRouteOrder', j.default_route_order,
        'createdAt', j.created_at
      )
      order by c.full_name, p.address_line1
    ),
    '[]'::jsonb
  )
  into v_result
  from public.jobs j
  join public.customers c on c.id = j.customer_id
  left join public.properties p on p.id = j.property_id
  left join public.crews cr on cr.id = j.default_crew_id
  where coalesce(j.company_id, j.organization_id) = v_company_id
    and j.active;

  return v_result;
end;
$function$;

commit;
