begin;

-- The company Admin is the only source of the Employee daily house limit.
-- Smart Route and route publication must not impose a separate fixed ceiling.

alter table if exists public.profiles
  drop constraint if exists profiles_daily_route_capacity_check;
alter table if exists public.employees
  drop constraint if exists employees_daily_route_capacity_check;

alter table if exists public.profiles
  add constraint profiles_daily_route_capacity_check
  check (daily_route_capacity >= 1);
alter table if exists public.employees
  add constraint employees_daily_route_capacity_check
  check (daily_route_capacity >= 1);

update public.profiles
set daily_route_capacity = greatest(1, coalesce(daily_route_capacity, 16));
update public.employees
set daily_route_capacity = greatest(1, coalesce(daily_route_capacity, 16));

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
    new.daily_route_capacity := greatest(1, v_capacity);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_sync_route_capacity_from_profile
  on public.employees;
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
  set daily_route_capacity = greatest(1, new.daily_route_capacity)
  where profile_id = new.id
    and daily_route_capacity
      is distinct from greatest(1, new.daily_route_capacity);
  return new;
end;
$$;

drop trigger if exists profiles_sync_route_capacity_to_employee
  on public.profiles;
create trigger profiles_sync_route_capacity_to_employee
after insert or update of daily_route_capacity
on public.profiles
for each row
execute function public.sync_profile_route_capacity_to_employee();

notify pgrst, 'reload schema';

commit;
