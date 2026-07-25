begin;

alter table public.customers
  add column if not exists acquisition_source text not null default 'company'
  check (acquisition_source in ('company','platform'));

alter table public.customers
  add column if not exists platform_managed boolean not null default false;

alter table public.customers
  add column if not exists assigned_by_master_at timestamptz;

alter table public.customers
  add column if not exists assigned_by_master_id uuid references public.profiles(id) on delete set null;

create index if not exists customers_platform_managed_idx
  on public.customers(platform_managed, company_id);

update public.customers c
set acquisition_source = 'platform',
    platform_managed = true
where exists (
  select 1
  from public.lead_center l
  where l.customer_id = c.id
    and l.created_by_master_id is not null
);

grant select, insert, update on public.customers to service_role;
grant select, insert, update on public.properties to service_role;
grant select, update on public.lead_center to service_role;
grant select on public.organizations to service_role;

commit;
