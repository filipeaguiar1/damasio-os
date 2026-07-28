begin;

-- Damasio OS — compatibility repair for environments that did not receive the
-- Route Advisor capacity columns. Daily publication reads capacity from the
-- canonical Employee row, while Admin settings may originate on Profile.

alter table public.profiles
  add column if not exists daily_route_capacity integer;

alter table public.employees
  add column if not exists daily_route_capacity integer;

update public.profiles
set daily_route_capacity = greatest(1, least(60, coalesce(daily_route_capacity, 16)));

update public.employees e
set daily_route_capacity = greatest(
  1,
  least(60, coalesce(p.daily_route_capacity, e.daily_route_capacity, 16))
)
from public.profiles p
where e.profile_id = p.id;

update public.employees
set daily_route_capacity = greatest(1, least(60, coalesce(daily_route_capacity, 16)))
where daily_route_capacity is null
   or daily_route_capacity < 1
   or daily_route_capacity > 60;

alter table public.profiles
  alter column daily_route_capacity set default 16,
  alter column daily_route_capacity set not null;

alter table public.employees
  alter column daily_route_capacity set default 16,
  alter column daily_route_capacity set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_daily_route_capacity_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_daily_route_capacity_check
      check (daily_route_capacity between 1 and 60)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_daily_route_capacity_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_daily_route_capacity_check
      check (daily_route_capacity between 1 and 60)
      not valid;
  end if;
end $$;

alter table public.profiles
  validate constraint profiles_daily_route_capacity_check;

alter table public.employees
  validate constraint employees_daily_route_capacity_check;

create or replace function public.sync_employee_route_capacity_from_profile()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_capacity integer;
begin
  if new.profile_id is null then
    new.daily_route_capacity := greatest(1, least(60, coalesce(new.daily_route_capacity, 16)));
    return new;
  end if;

  select p.daily_route_capacity
  into v_capacity
  from public.profiles p
  where p.id = new.profile_id;

  new.daily_route_capacity := greatest(
    1,
    least(60, coalesce(v_capacity, new.daily_route_capacity, 16))
  );
  return new;
end;
$$;

create or replace function public.sync_profile_route_capacity_to_employee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.employees
  set daily_route_capacity = greatest(1, least(60, new.daily_route_capacity))
  where profile_id = new.id
    and daily_route_capacity is distinct from greatest(1, least(60, new.daily_route_capacity));
  return new;
end;
$$;

drop trigger if exists employees_sync_route_capacity_from_profile on public.employees;
create trigger employees_sync_route_capacity_from_profile
before insert or update of profile_id, daily_route_capacity
on public.employees
for each row
execute function public.sync_employee_route_capacity_from_profile();

drop trigger if exists profiles_sync_route_capacity_to_employee on public.profiles;
create trigger profiles_sync_route_capacity_to_employee
after insert or update of daily_route_capacity
on public.profiles
for each row
execute function public.sync_profile_route_capacity_to_employee();

comment on column public.employees.daily_route_capacity is
  'Canonical maximum number of dated Visits that can be published to this Employee per day.';

notify pgrst, 'reload schema';

commit;
