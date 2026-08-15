-- Final security hardening phase 3.
-- Default-deny SECURITY DEFINER exposure and keep internal writers server-only.

begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.proname <> 'get_platform_season_theme'
  loop
    execute format('revoke execute on function %s from public, anon',r.signature);
    execute format('grant execute on function %s to authenticated, service_role',r.signature);
  end loop;
end
$$;

-- Canonical infrastructure helpers are never direct client APIs.
do $$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    to_regprocedure('public.safe_queue_route_map_rebuild(uuid,uuid,text)'),
    to_regprocedure('public.sync_visit_route_order_for_route(uuid)'),
    to_regprocedure('public.replace_canonical_route_order_v2(uuid,uuid[],text,uuid,integer,boolean)'),
    to_regprocedure('public.apply_canonical_route_order_v2_service(uuid,uuid[],text,double precision,double precision,integer,uuid,text)'),
    to_regprocedure('public.sync_canonical_route_stops_v2(uuid,text)'),
    to_regprocedure('public.credit_customer_wallet(uuid,uuid,bigint,text,text)'),
    to_regprocedure('public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text)'),
    to_regprocedure('public.refresh_payout_release_status(uuid)'),
    to_regprocedure('public.begin_operational_simulation_reset(uuid,text)'),
    to_regprocedure('public.begin_operational_simulation_run(uuid,text,text,text,uuid,jsonb)'),
    to_regprocedure('public.cleanup_operational_simulation_visits(uuid,uuid[])'),
    to_regprocedure('public.apply_quote_company_origin()'),
    to_regprocedure('public.guard_active_canonical_route_order()'),
    to_regprocedure('public.hold_payout_from_open_task()'),
    to_regprocedure('public.mark_customer_ready_after_payment()'),
    to_regprocedure('public.record_task_status_event()'),
    to_regprocedure('public.refresh_payout_from_feedback()'),
    to_regprocedure('public.route_stop_changed()'),
    to_regprocedure('public.route_stops_company_org_sync()'),
    to_regprocedure('public.sync_employee_email_from_auth()'),
    to_regprocedure('public.sync_employee_email_from_employee()'),
    to_regprocedure('public.sync_employee_email_from_profile()'),
    to_regprocedure('public.sync_route_stop_from_visit()'),
    to_regprocedure('public.master_queue_expired_company_purges()'),
    to_regprocedure('public.master_restore_company(uuid,uuid)'),
    to_regprocedure('public.master_trash_company(uuid,uuid,text)')
  ] loop
    if v_signature is not null then
      execute format('revoke execute on function %s from public, anon, authenticated',v_signature);
      execute format('grant execute on function %s to service_role',v_signature);
    end if;
  end loop;
end
$$;

-- Superseded browser writers. Current application paths use canonical APIs/wrappers.
do $$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    to_regprocedure('public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text)'),
    to_regprocedure('public.create_job_for_customer_property(uuid,uuid,text,text)'),
    to_regprocedure('public.schedule_job_on_route(uuid,uuid,date,integer)'),
    to_regprocedure('public.move_visit_to_route(uuid,uuid,date,integer)'),
    to_regprocedure('public.save_job_route_pattern(uuid,uuid,date,integer)')
  ] loop
    if v_signature is not null then
      execute format('revoke execute on function %s from public, anon, authenticated',v_signature);
      execute format('grant execute on function %s to service_role',v_signature);
    end if;
  end loop;
end
$$;

notify pgrst,'reload schema';

commit;
