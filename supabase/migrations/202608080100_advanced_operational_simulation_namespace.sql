begin;

-- Advanced Operational Simulator V2
--
-- A run is uniquely scoped by (company_id, namespace). The registry is not a
-- parallel operational data model: Customer, Property, Quote, Job, Route,
-- route_stops, Visit, Invoice and the other business tables remain canonical.
-- The registry only records ownership/configuration so creation/reset can be
-- idempotent and independently repeatable for multiple companies/namespaces.
create table if not exists public.operational_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  namespace text not null,
  version integer not null default 2,
  scenario text not null,
  run_id text,
  status text not null default 'creating',
  config jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reset_at timestamptz,
  last_error text,
  constraint operational_simulation_runs_company_namespace_key
    unique (company_id, namespace),
  constraint operational_simulation_runs_namespace_check
    check (
      char_length(namespace) between 1 and 32
      and namespace ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ),
  constraint operational_simulation_runs_version_check
    check (version >= 2),
  constraint operational_simulation_runs_status_check
    check (status in ('creating', 'ready', 'resetting', 'failed', 'removed'))
);

create index if not exists operational_simulation_runs_company_status_idx
  on public.operational_simulation_runs (company_id, status);

create index if not exists operational_simulation_runs_updated_idx
  on public.operational_simulation_runs (updated_at desc);

alter table public.operational_simulation_runs enable row level security;

revoke all on table public.operational_simulation_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.operational_simulation_runs to service_role;

comment on table public.operational_simulation_runs is
  'QA-only ownership/configuration registry for namespaced Operational Simulator V2 runs. Business records remain in canonical tables.';

-- Atomic create acquisition. A removed/failed namespace may be reused; a ready,
-- creating or resetting namespace cannot be acquired by a second request.
create or replace function public.begin_operational_simulation_run(
  p_company_id uuid,
  p_namespace text,
  p_scenario text,
  p_run_id text,
  p_created_by uuid,
  p_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
  v_run jsonb;
begin
  if p_company_id is null then
    raise exception 'Advanced simulation requires a company.';
  end if;

  insert into public.operational_simulation_runs as existing (
    company_id,
    namespace,
    version,
    scenario,
    run_id,
    status,
    config,
    counts,
    created_by,
    created_at,
    updated_at,
    reset_at,
    last_error
  )
  values (
    p_company_id,
    p_namespace,
    2,
    p_scenario,
    p_run_id,
    'creating',
    coalesce(p_config, '{}'::jsonb),
    '{}'::jsonb,
    p_created_by,
    now(),
    now(),
    null,
    null
  )
  on conflict (company_id, namespace) do update
  set
    version = 2,
    scenario = excluded.scenario,
    run_id = excluded.run_id,
    status = 'creating',
    config = excluded.config,
    counts = '{}'::jsonb,
    created_by = excluded.created_by,
    created_at = now(),
    updated_at = now(),
    reset_at = null,
    last_error = null
  where existing.status in ('failed', 'removed')
  returning id into v_id;

  if v_id is null then
    select status
    into v_status
    from public.operational_simulation_runs
    where company_id = p_company_id
      and namespace = p_namespace;
    raise exception 'Simulation namespace "%" cannot be acquired while status is %.',
      p_namespace,
      coalesce(v_status, 'unknown');
  end if;

  select to_jsonb(r)
  into v_run
  from public.operational_simulation_runs r
  where r.id = v_id;

  return v_run;
end;
$$;

revoke all on function public.begin_operational_simulation_run(uuid, text, text, text, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.begin_operational_simulation_run(uuid, text, text, text, uuid, jsonb)
to service_role;

-- Atomic reset acquisition. A concurrent second reset never runs cleanup in
-- parallel: it receives acquired=false while the first request owns resetting.
create or replace function public.begin_operational_simulation_reset(
  p_company_id uuid,
  p_namespace text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.operational_simulation_runs%rowtype;
begin
  select *
  into v_run
  from public.operational_simulation_runs
  where company_id = p_company_id
    and namespace = p_namespace
  for update;

  if not found then
    return jsonb_build_object(
      'acquired', false,
      'alreadyRemoved', true,
      'run', null
    );
  end if;

  if v_run.status = 'removed' then
    return jsonb_build_object(
      'acquired', false,
      'alreadyRemoved', true,
      'run', to_jsonb(v_run)
    );
  end if;

  if v_run.status = 'creating' then
    raise exception 'Simulation namespace "%" is still being created.', p_namespace;
  end if;

  if v_run.status = 'resetting' then
    return jsonb_build_object(
      'acquired', false,
      'alreadyRemoved', false,
      'run', to_jsonb(v_run)
    );
  end if;

  update public.operational_simulation_runs
  set
    status = 'resetting',
    updated_at = now(),
    last_error = null
  where id = v_run.id
  returning * into v_run;

  return jsonb_build_object(
    'acquired', true,
    'alreadyRemoved', false,
    'run', to_jsonb(v_run)
  );
end;
$$;

revoke all on function public.begin_operational_simulation_reset(uuid, text)
from public, anon, authenticated;
grant execute on function public.begin_operational_simulation_reset(uuid, text)
to service_role;

-- Upgrade the existing QA-only Visit cleanup primitive so it recognizes both
-- legacy V1 accounts and V2 namespaced accounts. It still refuses any Customer
-- outside the authenticated company simulator patterns before enabling the
-- protected canonical delete context.
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
  v_company_token text := left(replace(p_company_id::text, '-', ''), 8);
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
    and (
      lower(coalesce(c.email, '')) like lower(
        'ops-sim-' || left(p_company_id::text, 8) || '-%@4everseasons.test'
      )
      or lower(coalesce(c.email, '')) like lower(
        'ops-sim-v2-' || v_company_token || '-%@4everseasons.test'
      )
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
