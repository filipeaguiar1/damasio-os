-- Remove accidental PUBLIC/anon execution from operational read RPCs.
-- Public health/theme reads remain intentionally untouched.

do $$
declare
  v_signature text;
  v_fn regprocedure;
begin
  foreach v_signature in array array[
    'public.get_company_dispatch_jobs()',
    'public.get_customer_property_directory()',
    'public.get_company_referral_inbox()',
    'public.get_operations_board()',
    'public.get_scheduling_dispatch_board()',
    'public.get_employee_smart_route_state(uuid)',
    'public.get_canonical_route_order_v2(uuid)'
  ] loop
    v_fn:=to_regprocedure(v_signature);
    if v_fn is not null then
      execute format('revoke execute on function %s from public,anon',v_fn);
      execute format('grant execute on function %s to authenticated,service_role',v_fn);
    end if;
  end loop;
end
$$;
