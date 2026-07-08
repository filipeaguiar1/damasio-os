-- Damasio OS V41.1 - Auth onboarding helper
-- Optional but recommended after 01_schema.sql and 02_rls_policies.sql.
-- It creates a company and admin profile automatically when a new owner signs up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  company_name text;
  clean_slug text;
begin
  company_name := coalesce(new.raw_user_meta_data->>'company_name', 'New Company');
  clean_slug := lower(regexp_replace(company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' then clean_slug := 'company'; end if;

  insert into public.organizations(name, slug)
  values (company_name, clean_slug || '-' || substr(new.id::text,1,8))
  returning id into org_id;

  insert into public.profiles(id, organization_id, role, full_name, email, active)
  values (
    new.id,
    org_id,
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'admin'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    true
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
