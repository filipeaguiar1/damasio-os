begin;

-- Damasio OS — compatibility repair for Supabase environments that still use
-- organization_id on Quotes/Jobs but do not yet expose the canonical company_id.
-- Both identifiers remain synchronized so Customer → Property → Quote → Job
-- creation uses one tenant identity in old and new environments.

alter table public.quotes
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.quotes
  add column if not exists company_id uuid references public.organizations(id) on delete cascade;

alter table public.jobs
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.jobs
  add column if not exists company_id uuid references public.organizations(id) on delete cascade;

-- Prefer the legacy organization identifier when it is already populated.
update public.quotes
set company_id = organization_id
where company_id is null
  and organization_id is not null;

update public.jobs
set company_id = organization_id
where company_id is null
  and organization_id is not null;

-- Repair older Quote ownership from its canonical Customer or Property.
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

-- Repair older Job ownership from Quote, Customer or Property evidence.
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

-- Complete either identifier when only the other is available.
update public.quotes
set organization_id = company_id
where organization_id is null
  and company_id is not null;

update public.jobs
set organization_id = company_id
where organization_id is null
  and company_id is not null;

create index if not exists idx_quotes_company_id_compat
  on public.quotes(company_id);

create index if not exists idx_jobs_company_id_compat
  on public.jobs(company_id);

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

drop trigger if exists trg_quotes_sync_company on public.quotes;
create trigger trg_quotes_sync_company
before insert or update of company_id, organization_id
on public.quotes
for each row execute function public.sync_company_identifier();

drop trigger if exists trg_jobs_sync_company on public.jobs;
create trigger trg_jobs_sync_company
before insert or update of company_id, organization_id
on public.jobs
for each row execute function public.sync_company_identifier();

notify pgrst, 'reload schema';

commit;
