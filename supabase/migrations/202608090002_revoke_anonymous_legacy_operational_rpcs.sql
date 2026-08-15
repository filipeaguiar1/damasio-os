-- Remove accidental PUBLIC/anon execution from legacy operational RPCs.
-- Authenticated and service_role behavior is preserved.

do $$
declare
  v_signature text;
  v_fn regprocedure;
begin
  foreach v_signature in array array[
    'public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text)',
    'public.create_job_for_customer_property(uuid,uuid,text,text)',
    'public.create_operation_quote(uuid,uuid,text,numeric,text)',
    'public.create_operation_task(uuid,uuid,text,text,text,date)',
    'public.move_visit_to_route(uuid,uuid,date,integer)',
    'public.resolve_operation_task(uuid,text)',
    'public.respond_company_referral(uuid,boolean)',
    'public.save_job_route_pattern(uuid,uuid,date,integer)',
    'public.schedule_job_on_route(uuid,uuid,date,integer)',
    'public.set_operation_quote_status(uuid,text)'
  ] loop
    v_fn:=to_regprocedure(v_signature);
    if v_fn is not null then
      execute format('revoke execute on function %s from public,anon',v_fn);
      execute format('grant execute on function %s to authenticated,service_role',v_fn);
    end if;
  end loop;
end
$$;
