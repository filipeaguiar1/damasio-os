begin;

-- Canonical ownership model already used by the platform:
-- platform = customer acquired by the platform and locked for company Admins
-- company_referral / company_created = customer owned and editable by the company
alter table public.customers
  add column if not exists acquisition_source text not null default 'platform'
    check (acquisition_source in ('platform','company_referral','company_created')),
  add column if not exists origin_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists service_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists assignment_status text not null default 'pending_payment'
    check (assignment_status in ('pending_payment','ready_for_assignment','assigned','paused','cancelled'));

-- Customers created from a Master/platform lead remain platform-owned even after
-- a servicing company is assigned.
update public.customers c
set acquisition_source = 'platform'
where exists (
  select 1
  from public.lead_center l
  where l.customer_id = c.id
    and l.created_by_master_id is not null
);

-- Company-created customers are explicitly company-owned when there is no
-- platform lead proving otherwise.
update public.customers c
set acquisition_source = 'company_created',
    origin_company_id = coalesce(c.origin_company_id, c.company_id, c.organization_id),
    service_company_id = coalesce(c.service_company_id, c.company_id, c.organization_id),
    assignment_status = case
      when coalesce(c.service_company_id, c.company_id, c.organization_id) is null then c.assignment_status
      else 'assigned'
    end
where c.acquisition_source = 'platform'
  and not exists (
    select 1
    from public.lead_center l
    where l.customer_id = c.id
      and l.created_by_master_id is not null
  )
  and coalesce(c.company_id, c.organization_id) is not null;

grant select, insert, update on public.customers to service_role;
grant select, insert, update on public.properties to service_role;
grant select, update on public.lead_center to service_role;
grant select on public.organizations to service_role;

commit;
