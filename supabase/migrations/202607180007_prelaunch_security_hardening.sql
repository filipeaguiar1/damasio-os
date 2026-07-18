-- Final public-role hardening before customer acquisition.
-- Public health/theme reads remain intentional; operational/customer data does not.
begin;

-- Environments created at different product versions do not necessarily have
-- every legacy RPC. Missing functions are safely skipped.
do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.get_customer_property_directory()',
    'public.get_property_photo_history(uuid)',
    'public.archive_company_customers(uuid[])',
    'public.claim_quote_by_number(text)',
    'public.get_customer_portal_board()',
    'public.create_customer_portal_request(text,text)',
    'public.submit_customer_portal_feedback(uuid,uuid,integer,text)',
    'public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text)',
    'public.get_scheduling_dispatch_board()',
    'public.schedule_job_on_route(uuid,uuid,date,integer)',
    'public.move_visit_to_route(uuid,uuid,date,integer)',
    'public.set_visit_dispatch_status(uuid,text)',
    'public.get_company_referral_inbox()',
    'public.respond_company_referral(uuid,boolean)',
    'public.create_job_for_customer_property(uuid,uuid,text,text)',
    'public.get_company_dispatch_jobs()',
    'public.assign_job_to_crew(uuid,uuid)',
    'public.save_job_route_pattern(uuid,uuid,date,integer)'
  ] loop
    v_function:=to_regprocedure(v_signature);
    if v_function is not null then
      execute format('revoke execute on function %s from anon',v_function);
    end if;
  end loop;
end
$$;

commit;
