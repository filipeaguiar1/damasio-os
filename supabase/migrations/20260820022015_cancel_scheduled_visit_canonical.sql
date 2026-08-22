create or replace function public.cancel_scheduled_visit(
  p_visit_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_visit public.visits%rowtype;
  v_company_id uuid;
  v_reason text := trim(coalesce(p_reason, ''));
  v_removed jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and active;

  if not found or v_profile.role::text not in ('admin','manager') then
    raise exception 'Only an active company Admin can cancel a scheduled Visit.';
  end if;

  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);
  if v_company_id is null then
    raise exception 'Admin profile is not linked to a company.';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A cancellation reason is required.';
  end if;

  select * into v_visit
  from public.visits
  where id = p_visit_id
    and coalesce(company_id, organization_id) = v_company_id
  for update;

  if not found then
    raise exception 'Visit not found for this company.';
  end if;

  if v_visit.status::text in ('completed','in_progress') then
    raise exception 'Active or completed Visits cannot be cancelled from the route view.';
  end if;

  if v_visit.status::text = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'alreadyCancelled', true, 'visitId', p_visit_id);
  end if;

  if v_visit.status::text <> 'scheduled' then
    raise exception 'Only Scheduled Visits can be cancelled from the route view.';
  end if;

  v_removed := public.remove_visits_from_today_route(array[p_visit_id], 'Cancelled service: ' || v_reason);

  perform set_config('damasio.visit_transition_context', 'admin_cancel_service', true);
  update public.visits
  set status = 'cancelled',
      payment_hold = true,
      payment_release_status = 'cancelled',
      payment_release_eligible_at = null,
      payment_release_reason = 'Service cancelled: ' || v_reason,
      updated_at = clock_timestamp()
  where id = p_visit_id
    and coalesce(company_id, organization_id) = v_company_id;

  return jsonb_build_object(
    'cancelled', true,
    'visitId', p_visit_id,
    'routeIds', coalesce(v_removed->'routeIds', '[]'::jsonb),
    'reason', v_reason
  );
end;
$$;

revoke all on function public.cancel_scheduled_visit(uuid,text) from public, anon;
grant execute on function public.cancel_scheduled_visit(uuid,text) to authenticated, service_role;
notify pgrst, 'reload schema';
