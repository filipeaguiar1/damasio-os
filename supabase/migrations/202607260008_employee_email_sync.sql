-- Canonical employee email synchronization.
-- employee_id/profile_id remains the primary operational identity.
-- Email is synchronized across auth.users, public.profiles and public.employees.

create or replace function public.sync_employee_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null or new.email is not distinct from old.email then
    return new;
  end if;

  update public.profiles
  set email = lower(trim(new.email))
  where id = new.id
    and role = 'employee'
    and email is distinct from lower(trim(new.email));

  update public.employees
  set email = lower(trim(new.email))
  where profile_id = new.id
    and email is distinct from lower(trim(new.email));

  return new;
end;
$$;

drop trigger if exists trg_sync_employee_email_from_auth on auth.users;
create trigger trg_sync_employee_email_from_auth
after update of email on auth.users
for each row
execute function public.sync_employee_email_from_auth();

create or replace function public.sync_employee_email_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.role <> 'employee' or new.email is null then
    return new;
  end if;

  new.email := lower(trim(new.email));

  update public.employees
  set email = new.email,
      profile_id = new.id
  where (profile_id = new.id)
     or (
       profile_id is null
       and active = true
       and email is not null
       and lower(trim(email)) = new.email
     );

  update auth.users
  set email = new.email,
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      updated_at = now()
  where id = new.id
    and email is distinct from new.email;

  return new;
end;
$$;

drop trigger if exists trg_sync_employee_email_from_profile on public.profiles;
create trigger trg_sync_employee_email_from_profile
before insert or update of email, role on public.profiles
for each row
execute function public.sync_employee_email_from_profile();

create or replace function public.sync_employee_email_from_employee()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null then
    return new;
  end if;

  new.email := lower(trim(new.email));

  if new.profile_id is not null then
    update public.profiles
    set email = new.email
    where id = new.profile_id
      and role = 'employee'
      and email is distinct from new.email;

    update auth.users
    set email = new.email,
        email_change = '',
        email_change_token_new = '',
        email_change_token_current = '',
        email_change_confirm_status = 0,
        updated_at = now()
    where id = new.profile_id
      and email is distinct from new.email;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_employee_email_from_employee on public.employees;
create trigger trg_sync_employee_email_from_employee
before insert or update of email, profile_id on public.employees
for each row
execute function public.sync_employee_email_from_employee();

-- Repair existing linked employee records using the authenticated email as source of truth.
update public.profiles p
set email = lower(trim(u.email))
from auth.users u
where p.id = u.id
  and p.role = 'employee'
  and u.email is not null
  and p.email is distinct from lower(trim(u.email));

update public.employees e
set email = lower(trim(u.email))
from auth.users u
where e.profile_id = u.id
  and u.email is not null
  and e.email is distinct from lower(trim(u.email));
