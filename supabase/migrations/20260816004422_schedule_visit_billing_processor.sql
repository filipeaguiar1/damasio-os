create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname='process-visit-billing-events-hourly';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  select jobid into v_job_id
  from cron.job
  where jobname='prune-cron-history-daily';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$$;

select cron.schedule(
  'process-visit-billing-events-hourly',
  '0 * * * *',
  $$select public.process_visit_billing_events(500);$$
);

select cron.schedule(
  'prune-cron-history-daily',
  '25 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '30 days';$$
);
