-- Final security hardening phase 4.
-- Protect diagnostics, keep the public season theme read safe, and optimize customer RLS helpers.

begin;

create or replace function public.database_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_names text[]:=array[
    'organizations','profiles','customers','employees','crews','properties',
    'service_requests','quotes','invoices','payments','jobs','routes','visits',
    'tasks','photos','feedback','activity_log','employee_smart_route_state'
  ];
  check_table_name text;
  table_exists boolean;
  row_count integer;
  checks jsonb:='[]'::jsonb;
begin
  perform public.require_active_company_operator();

  foreach check_table_name in array table_names loop
    select exists(
      select 1
      from information_schema.tables
      where table_schema='public' and table_name=check_table_name
    ) into table_exists;

    if table_exists then
      execute format('select count(*) from public.%I',check_table_name) into row_count;
      checks:=checks||jsonb_build_object('table',check_table_name,'exists',true,'visible_rows',row_count,'error',null);
    else
      checks:=checks||jsonb_build_object('table',check_table_name,'exists',false,'visible_rows',null,'error','Table not found');
    end if;
  end loop;

  return jsonb_build_object('ok',true,'checked_at',now(),'tables',checks);
end;
$$;

create or replace function public.storage_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public,storage
as $$
declare
  bucket_names text[]:=array['property-photos','work-photos','task-photos','before-after','documents'];
  check_bucket_name text;
  bucket_exists boolean;
  checks jsonb:='[]'::jsonb;
begin
  perform public.require_active_company_operator();

  foreach check_bucket_name in array bucket_names loop
    select exists(select 1 from storage.buckets where id=check_bucket_name) into bucket_exists;
    checks:=checks||jsonb_build_object('bucket',check_bucket_name,'exists',bucket_exists);
  end loop;

  return jsonb_build_object(
    'ok',not exists(
      select 1
      from unnest(bucket_names) as required_bucket
      where not exists(select 1 from storage.buckets where id=required_bucket)
    ),
    'checked_at',now(),
    'buckets',checks
  );
end;
$$;

create or replace function public.route_stops_health_check()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'routeStopsTable',to_regclass('public.route_stops') is not null,
    'safeQueueFunction',to_regprocedure('public.safe_queue_route_map_rebuild(uuid,uuid,text)') is not null,
    'publishFunction',to_regprocedure('public.publish_official_route_stops(uuid,date,uuid[])') is not null,
    'oldQueueReferences',coalesce((
      select jsonb_agg(p.proname)
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.prosrc like '%queue_route_map_rebuild%'
        and p.prosrc not like '%safe_queue_route_map_rebuild%'
    ),'[]'::jsonb),
    'routeStopsCount',(select count(*) from public.route_stops),
    'visitsMissingOfficialStop',(
      select count(*)
      from public.visits v
      where v.route_id is not null
        and v.status <> 'cancelled'
        and not exists(
          select 1
          from public.route_stops rs
          where rs.route_id=v.route_id and rs.visit_id=v.id
        )
    ),
    'orphanRouteStops',(
      select count(*)
      from public.route_stops rs
      where not exists(select 1 from public.visits v where v.id=rs.visit_id)
    )
  )
  where public.require_active_company_operator();
$$;

revoke execute on function public.database_health_check() from public,anon;
revoke execute on function public.storage_health_check() from public,anon;
revoke execute on function public.route_stops_health_check() from public,anon;
grant execute on function public.database_health_check() to authenticated,service_role;
grant execute on function public.storage_health_check() to authenticated,service_role;
grant execute on function public.route_stops_health_check() to authenticated,service_role;

-- Public seasonal theme is intentionally readable, but must not bypass RLS with SECURITY DEFINER.
grant select (singleton,season_mode,season,updated_at) on table public.platform_theme_settings to anon,authenticated;

create or replace function public.get_platform_season_theme()
returns table(season_mode text,season text,updated_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select t.season_mode,t.season,t.updated_at
  from public.platform_theme_settings t
  where t.singleton;
$$;

revoke execute on function public.get_platform_season_theme() from public;
grant execute on function public.get_platform_season_theme() to anon,authenticated,service_role;

-- Explicit search paths for helper/trigger functions flagged by the database advisor.
alter function public.update_customer_payment_preferences_timestamp() set search_path=public;
alter function public.weekly_company_payout_week_start(date) set search_path=public;
alter function public.weekly_company_payout_date(date) set search_path=public;
alter function public.weekly_company_payout_week_end(date) set search_path=public;
alter function public.calculate_platform_revenue(numeric,numeric) set search_path=public;
alter function public.update_platform_revenue() set search_path=public;

-- Avoid repeated auth/helper evaluation for every row in customer RLS policies.
create index if not exists customers_profile_id_idx
  on public.customers(profile_id)
  where profile_id is not null;

alter policy customers_customer_own on public.customers
  using (id=(select public.my_customer_id()));

alter policy feedback_customer_own on public.feedback
  using (customer_id=(select public.my_customer_id()))
  with check (customer_id=(select public.my_customer_id()));

alter policy invoices_customer_own on public.invoices
  using (customer_id=(select public.my_customer_id()));

alter policy jobs_customer_own on public.jobs
  using (customer_id=(select public.my_customer_id()));

alter policy payments_customer_own on public.payments
  using (customer_id=(select public.my_customer_id()));

alter policy photos_customer_own on public.photos
  using (
    property_id in (
      select p.id
      from public.properties p
      where p.customer_id=(select public.my_customer_id())
    )
  );

alter policy properties_customer_own on public.properties
  using (customer_id=(select public.my_customer_id()));

alter policy quotes_customer_own on public.quotes
  using (customer_id=(select public.my_customer_id()));

alter policy requests_customer_insert on public.service_requests
  with check (
    organization_id=public.app_org_id()
    and customer_id=(select public.my_customer_id())
  );

alter policy requests_customer_own on public.service_requests
  using (customer_id=(select public.my_customer_id()));

alter policy tasks_customer_insert on public.tasks
  with check (
    organization_id=public.app_org_id()
    and customer_id=(select public.my_customer_id())
  );

alter policy tasks_customer_own on public.tasks
  using (customer_id=(select public.my_customer_id()));

alter policy visits_customer_own on public.visits
  using (customer_id=(select public.my_customer_id()));

notify pgrst,'reload schema';

commit;
