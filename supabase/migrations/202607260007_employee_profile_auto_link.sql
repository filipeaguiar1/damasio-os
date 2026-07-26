-- Canonical employee identity repair.
-- Links employee login profiles to operational employee records by normalized email.

update public.employees e
set profile_id = p.id
from public.profiles p
where e.profile_id is null
  and e.active = true
  and p.active = true
  and p.role = 'employee'
  and e.email is not null
  and p.email is not null
  and lower(trim(e.email)) = lower(trim(p.email));

create or replace function public.link_employee_profile_by_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'employee' and new.active = true and new.email is not null then
    update public.employees
    set profile_id = new.id
    where profile_id is null
      and active = true
      and email is not null
      and lower(trim(email)) = lower(trim(new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_employee_profile_by_email on public.profiles;
create trigger trg_link_employee_profile_by_email
after insert or update of email, role, active
on public.profiles
for each row
execute function public.link_employee_profile_by_email();

-- Keep one authenticated profile linked to at most one operational employee.
create unique index if not exists employees_profile_id_unique
on public.employees(profile_id)
where profile_id is not null;
