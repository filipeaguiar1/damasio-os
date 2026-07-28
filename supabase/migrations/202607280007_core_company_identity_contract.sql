begin;

-- Damasio OS — universal tenant identity contract for the operational chain.
-- Every entity keeps its own UUID. company_id/organization_id identify the one
-- owning company and are synchronized; relationships always use canonical IDs.

create or replace function public.sync_company_identifier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := new.organization_id;
  end if;

  if new.organization_id is null then
    new.organization_id := new.company_id;
  end if;

  if new.company_id is distinct from new.organization_id then
    raise exception 'company_id and organization_id must reference the same company';
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'customers',
    'properties',
    'quotes',
    'jobs',
    'crews',
    'employees',
    'routes',
    'visits'
  ] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format(
        'alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade',
        t
      );
      execute format(
        'alter table public.%I add column if not exists company_id uuid references public.organizations(id) on delete cascade',
        t
      );
      execute format(
        'update public.%I set company_id = organization_id where company_id is null and organization_id is not null',
        t
      );
      execute format(
        'update public.%I set organization_id = company_id where organization_id is null and company_id is not null',
        t
      );
      execute format(
        'create index if not exists %I on public.%I(company_id)',
        'idx_' || t || '_company_identity_contract',
        t
      );
      execute format(
        'drop trigger if exists %I on public.%I',
        'trg_' || t || '_sync_company',
        t
      );
      execute format(
        'create trigger %I before insert or update of company_id, organization_id on public.%I for each row execute function public.sync_company_identifier()',
        'trg_' || t || '_sync_company',
        t
      );
    end if;
  end loop;
end $$;

-- Repair only rows whose company is missing and whose canonical parent provides
-- one unambiguous owner. Existing non-null ownership is never guessed or changed.
update public.properties p
set company_id = coalesce(c.company_id, c.organization_id),
    organization_id = coalesce(c.company_id, c.organization_id)
from public.customers c
where p.customer_id = c.id
  and (p.company_id is null or p.organization_id is null)
  and coalesce(c.company_id, c.organization_id) is not null;

update public.quotes q
set company_id = coalesce(c.company_id, c.organization_id),
    organization_id = coalesce(c.company_id, c.organization_id)
from public.customers c
where q.customer_id = c.id
  and (q.company_id is null or q.organization_id is null)
  and coalesce(c.company_id, c.organization_id) is not null;

update public.quotes q
set company_id = coalesce(p.company_id, p.organization_id),
    organization_id = coalesce(p.company_id, p.organization_id)
from public.properties p
where q.property_id = p.id
  and (q.company_id is null or q.organization_id is null)
  and coalesce(p.company_id, p.organization_id) is not null;

update public.jobs j
set company_id = coalesce(q.company_id, q.organization_id),
    organization_id = coalesce(q.company_id, q.organization_id)
from public.quotes q
where j.quote_id = q.id
  and (j.company_id is null or j.organization_id is null)
  and coalesce(q.company_id, q.organization_id) is not null;

update public.jobs j
set company_id = coalesce(c.company_id, c.organization_id),
    organization_id = coalesce(c.company_id, c.organization_id)
from public.customers c
where j.customer_id = c.id
  and (j.company_id is null or j.organization_id is null)
  and coalesce(c.company_id, c.organization_id) is not null;

update public.jobs j
set company_id = coalesce(p.company_id, p.organization_id),
    organization_id = coalesce(p.company_id, p.organization_id)
from public.properties p
where j.property_id = p.id
  and (j.company_id is null or j.organization_id is null)
  and coalesce(p.company_id, p.organization_id) is not null;

update public.employees e
set company_id = coalesce(p.company_id, p.organization_id),
    organization_id = coalesce(p.company_id, p.organization_id)
from public.profiles p
where e.profile_id = p.id
  and (e.company_id is null or e.organization_id is null)
  and coalesce(p.company_id, p.organization_id) is not null;

update public.employees e
set company_id = coalesce(c.company_id, c.organization_id),
    organization_id = coalesce(c.company_id, c.organization_id)
from public.crews c
where e.crew_id = c.id
  and (e.company_id is null or e.organization_id is null)
  and coalesce(c.company_id, c.organization_id) is not null;

update public.routes r
set company_id = coalesce(c.company_id, c.organization_id),
    organization_id = coalesce(c.company_id, c.organization_id)
from public.crews c
where r.crew_id = c.id
  and (r.company_id is null or r.organization_id is null)
  and coalesce(c.company_id, c.organization_id) is not null;

update public.visits v
set company_id = coalesce(j.company_id, j.organization_id),
    organization_id = coalesce(j.company_id, j.organization_id)
from public.jobs j
where v.job_id = j.id
  and (v.company_id is null or v.organization_id is null)
  and coalesce(j.company_id, j.organization_id) is not null;

update public.visits v
set company_id = coalesce(r.company_id, r.organization_id),
    organization_id = coalesce(r.company_id, r.organization_id)
from public.routes r
where v.route_id = r.id
  and (v.company_id is null or v.organization_id is null)
  and coalesce(r.company_id, r.organization_id) is not null;

create or replace function public.company_canonical_integrity_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_role text;
begin
  select coalesce(company_id, organization_id), role::text
  into v_company, v_role
  from public.profiles
  where id = auth.uid()
    and active
  limit 1;

  if v_company is null or v_role not in ('admin', 'manager', 'master') then
    raise exception 'Active company Admin access required';
  end if;

  return jsonb_build_object(
    'companyId', v_company,
    'customersMissingCompany', (
      select count(*) from public.customers
      where coalesce(company_id, organization_id) is null
    ),
    'propertiesWithoutCustomer', (
      select count(*) from public.properties
      where coalesce(company_id, organization_id) = v_company
        and customer_id is null
    ),
    'propertyCompanyMismatch', (
      select count(*)
      from public.properties p
      join public.customers c on c.id = p.customer_id
      where coalesce(p.company_id, p.organization_id) = v_company
        and coalesce(p.company_id, p.organization_id)
          is distinct from coalesce(c.company_id, c.organization_id)
    ),
    'quoteCompanyMismatch', (
      select count(*)
      from public.quotes q
      join public.customers c on c.id = q.customer_id
      where coalesce(q.company_id, q.organization_id) = v_company
        and coalesce(q.company_id, q.organization_id)
          is distinct from coalesce(c.company_id, c.organization_id)
    ),
    'jobCompanyMismatch', (
      select count(*)
      from public.jobs j
      join public.customers c on c.id = j.customer_id
      where coalesce(j.company_id, j.organization_id) = v_company
        and coalesce(j.company_id, j.organization_id)
          is distinct from coalesce(c.company_id, c.organization_id)
    ),
    'visitsWithoutJob', (
      select count(*) from public.visits
      where coalesce(company_id, organization_id) = v_company
        and job_id is null
    ),
    'visitCompanyMismatch', (
      select count(*)
      from public.visits v
      join public.jobs j on j.id = v.job_id
      where coalesce(v.company_id, v.organization_id) = v_company
        and coalesce(v.company_id, v.organization_id)
          is distinct from coalesce(j.company_id, j.organization_id)
    ),
    'routesWithoutCrew', (
      select count(*) from public.routes
      where coalesce(company_id, organization_id) = v_company
        and crew_id is null
    ),
    'employeesWithoutCrew', (
      select count(*) from public.employees
      where coalesce(company_id, organization_id) = v_company
        and active
        and crew_id is null
    )
  );
end;
$$;

revoke all on function public.company_canonical_integrity_report() from public, anon;
grant execute on function public.company_canonical_integrity_report() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
