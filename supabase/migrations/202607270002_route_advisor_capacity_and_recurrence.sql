begin;

alter table public.profiles
  add column if not exists daily_route_capacity integer not null default 16;

alter table public.employees
  add column if not exists daily_route_capacity integer not null default 16;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_daily_route_capacity_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_daily_route_capacity_check
      check (daily_route_capacity between 1 and 60);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_daily_route_capacity_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_daily_route_capacity_check
      check (daily_route_capacity between 1 and 60);
  end if;
end $$;

update public.employees e
set daily_route_capacity = greatest(1, least(60, coalesce(p.daily_route_capacity, e.daily_route_capacity, 16)))
from public.profiles p
where e.profile_id = p.id;

create or replace function public.sync_employee_route_capacity_from_profile()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_capacity integer;
begin
  if new.profile_id is null then return new; end if;
  select p.daily_route_capacity into v_capacity
  from public.profiles p
  where p.id = new.profile_id;
  if v_capacity is not null then
    new.daily_route_capacity := greatest(1, least(60, v_capacity));
  end if;
  return new;
end;
$$;

drop trigger if exists employees_sync_route_capacity_from_profile on public.employees;
create trigger employees_sync_route_capacity_from_profile
before insert or update of profile_id, daily_route_capacity
on public.employees
for each row
execute function public.sync_employee_route_capacity_from_profile();

create or replace function public.sync_profile_route_capacity_to_employee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.employees
  set daily_route_capacity = new.daily_route_capacity
  where profile_id = new.id
    and daily_route_capacity is distinct from new.daily_route_capacity;
  return new;
end;
$$;

drop trigger if exists profiles_sync_route_capacity_to_employee on public.profiles;
create trigger profiles_sync_route_capacity_to_employee
after insert or update of daily_route_capacity
on public.profiles
for each row
execute function public.sync_profile_route_capacity_to_employee();

-- Preserve exactly one active dated occurrence per permanent Job. Completed work wins,
-- followed by active work, scheduled work and finally skipped work.
with ranked as (
  select
    id,
    row_number() over (
      partition by job_id, scheduled_date
      order by
        case status
          when 'completed' then 1
          when 'in_progress' then 2
          when 'scheduled' then 3
          when 'missed' then 4
          else 5
        end,
        created_at,
        id
    ) as occurrence_number
  from public.visits
  where job_id is not null
    and scheduled_date is not null
    and status <> 'cancelled'
)
update public.visits v
set
  status = 'cancelled',
  route_id = null,
  assigned_employee_id = null,
  crew_id = null,
  route_order = null
from ranked r
where v.id = r.id
  and r.occurrence_number > 1;

create unique index if not exists visits_one_active_occurrence_per_job_day_idx
  on public.visits (job_id, scheduled_date)
  where status <> 'cancelled';

create or replace function public.enforce_employee_daily_route_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_capacity integer := 16;
  v_existing integer := 0;
begin
  if new.status = 'cancelled' or new.route_id is null or new.scheduled_date is null then
    return new;
  end if;

  if new.assigned_employee_id is not null then
    select e.id, coalesce(e.daily_route_capacity, 16)
      into v_employee_id, v_capacity
    from public.employees e
    where e.id = new.assigned_employee_id
      and e.active = true
    limit 1;
  elsif new.crew_id is not null then
    select e.id, coalesce(e.daily_route_capacity, 16)
      into v_employee_id, v_capacity
    from public.employees e
    where e.crew_id = new.crew_id
      and e.active = true
    order by e.created_at
    limit 1;
  end if;

  if v_employee_id is null then
    raise exception 'A published Visit must resolve to one active Employee';
  end if;

  select count(*)
    into v_existing
  from public.visits v
  where v.scheduled_date = new.scheduled_date
    and v.status <> 'cancelled'
    and v.route_id is not null
    and v.id is distinct from new.id
    and (
      v.assigned_employee_id = v_employee_id
      or (v.assigned_employee_id is null and v.crew_id = new.crew_id)
    );

  if v_existing + 1 > greatest(1, v_capacity) then
    raise exception 'Employee daily route capacity exceeded: % of % houses', v_existing + 1, v_capacity;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_employee_daily_capacity_guard on public.visits;
create trigger visits_employee_daily_capacity_guard
before insert or update of assigned_employee_id, crew_id, scheduled_date, route_id, status
on public.visits
for each row
execute function public.enforce_employee_daily_route_capacity();

create or replace function public.advance_job_after_completed_visit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_frequency text;
  v_next_date date;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.job_id is null then
    return new;
  end if;

  select lower(coalesce(nullif(j.service_frequency, ''), nullif(j.frequency, ''), 'one_time'))
    into v_frequency
  from public.jobs j
  where j.id = new.job_id
  limit 1;

  v_next_date := case v_frequency
    when 'weekly' then new.scheduled_date + 7
    when 'biweekly' then new.scheduled_date + 14
    when 'monthly' then (new.scheduled_date + interval '1 month')::date
    when 'one_time' then null
    else null
  end;

  update public.jobs
  set
    recurrence_anchor_date = new.scheduled_date,
    next_visit_date = v_next_date
  where id = new.job_id;

  -- The next date remains a forecast on Job. No future Visit or Route stop is
  -- created here; the Admin or planning window materializes it later.
  return new;
end;
$$;

drop trigger if exists visits_advance_job_after_completion on public.visits;
create trigger visits_advance_job_after_completion
after update of status
on public.visits
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function public.advance_job_after_completed_visit();

-- Keep recurrence forecasts on Job and only materialize dated Visits inside the
-- near-term planning window. This prevents months of forecast rows from being
-- treated as current customer services or route stops.
update public.visits v
set
  status = 'cancelled',
  route_id = null,
  assigned_employee_id = null,
  crew_id = null,
  route_order = null
where v.status = 'scheduled'
  and v.route_id is null
  and v.started_at is null
  and v.finished_at is null
  and v.scheduled_date > current_date + 14
  and exists (
    select 1
    from public.billing_agreements a
    where a.job_id = v.job_id
      and a.active = true
      and a.service_frequency <> 'one_time'
  );

create or replace function public.generate_agreement_visits(
  p_agreement_id uuid,
  p_horizon date default (current_date + 90)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agreement public.billing_agreements%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_profile public.profiles%rowtype;
  v_date date;
  v_effective_horizon date;
  v_step interval;
  v_created integer := 0;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  select * into v_agreement from public.billing_agreements where id = p_agreement_id and active = true;
  if v_agreement.id is null then raise exception 'Active agreement not found'; end if;
  select * into v_job from public.jobs where id = v_agreement.job_id;
  select * into v_customer from public.customers where id = v_agreement.customer_id;

  if v_agreement.contract_owner_role = 'master' and v_profile.role::text <> 'master' then
    raise exception 'Only Master can generate this schedule';
  end if;
  if v_agreement.contract_owner_role = 'company' and (
    v_profile.role::text not in ('admin','manager') or
    v_profile.organization_id is distinct from coalesce(v_customer.origin_company_id, v_customer.organization_id)
  ) then
    raise exception 'Only the owning company can generate this schedule';
  end if;

  v_date := greatest(coalesce(v_agreement.contract_starts_on, current_date), current_date);
  v_effective_horizon := least(
    p_horizon,
    current_date + 14,
    coalesce(v_agreement.contract_ends_on, current_date + 14)
  );

  update public.jobs
  set
    service_frequency = v_agreement.service_frequency,
    next_visit_date = v_date
  where id = v_job.id;

  if v_agreement.service_frequency = 'weekly' then v_step := interval '7 days';
  elsif v_agreement.service_frequency = 'biweekly' then v_step := interval '14 days';
  elsif v_agreement.service_frequency = 'monthly' then v_step := interval '1 month';
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'day' then v_step := make_interval(days => v_agreement.custom_frequency_interval);
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'week' then v_step := make_interval(weeks => v_agreement.custom_frequency_interval);
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'month' then v_step := make_interval(months => v_agreement.custom_frequency_interval);
  else v_step := null;
  end if;

  if v_agreement.service_frequency = 'one_time' then
    if v_date <= v_effective_horizon and not exists (
      select 1 from public.visits
      where job_id = v_job.id and scheduled_date = v_date and status::text <> 'cancelled'
    ) then
      insert into public.visits (organization_id, company_id, job_id, customer_id, property_id, scheduled_date, status)
      values (v_job.organization_id, v_job.company_id, v_job.id, v_job.customer_id, v_job.property_id, v_date, 'scheduled');
      v_created := 1;
    end if;
    return v_created;
  end if;

  if v_step is null then return 0; end if;

  while v_date <= v_effective_horizon loop
    if not exists (
      select 1 from public.visits
      where job_id = v_job.id and scheduled_date = v_date and status::text <> 'cancelled'
    ) then
      insert into public.visits (organization_id, company_id, job_id, customer_id, property_id, scheduled_date, status)
      values (v_job.organization_id, v_job.company_id, v_job.id, v_job.customer_id, v_job.property_id, v_date, 'scheduled');
      v_created := v_created + 1;
    end if;
    v_date := (v_date::timestamp + v_step)::date;
  end loop;

  return v_created;
end;
$$;

notify pgrst, 'reload schema';

commit;
