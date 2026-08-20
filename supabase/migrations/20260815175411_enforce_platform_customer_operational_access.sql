create or replace function public.company_customer_access(
  p_customer_id uuid,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_customer public.customers%rowtype;
begin
  select coalesce(p.company_id, p.organization_id)
    into v_company
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and p.role::text = 'admin'
  limit 1;

  if v_company is null then
    return false;
  end if;

  select *
    into v_customer
  from public.customers c
  where c.id = p_customer_id
    and c.archived_at is null
  limit 1;

  if v_customer.id is null then
    return false;
  end if;

  if coalesce(v_customer.platform_managed, false)
     or v_customer.acquisition_source = 'platform' then
    if p_write then
      return false;
    end if;

    return v_customer.service_company_id = v_company
      and v_customer.offer_status = 'accepted'
      and coalesce(v_customer.assignment_status, '') in ('accepted','assigned','active');
  end if;

  return v_customer.organization_id = v_company
    and (v_customer.company_id is null or v_customer.company_id = v_company);
end;
$function$;

revoke all on function public.company_customer_access(uuid, boolean) from public, anon;
grant execute on function public.company_customer_access(uuid, boolean) to authenticated;

drop policy if exists customers_admin_all on public.customers;
drop policy if exists customers_admin_select on public.customers;
drop policy if exists customers_admin_insert on public.customers;
drop policy if exists customers_admin_update on public.customers;
drop policy if exists customers_admin_delete on public.customers;

create policy customers_admin_select
on public.customers
for select
to authenticated
using (public.company_customer_access(id, false));

create policy customers_admin_insert
on public.customers
for insert
to authenticated
with check (
  is_admin()
  and organization_id = app_org_id()
  and (company_id is null or company_id = app_org_id())
  and not coalesce(platform_managed, false)
  and coalesce(acquisition_source, 'company_created') <> 'platform'
);

create policy customers_admin_update
on public.customers
for update
to authenticated
using (public.company_customer_access(id, true))
with check (
  is_admin()
  and organization_id = app_org_id()
  and (company_id is null or company_id = app_org_id())
  and not coalesce(platform_managed, false)
  and coalesce(acquisition_source, 'company_created') <> 'platform'
);

create policy customers_admin_delete
on public.customers
for delete
to authenticated
using (public.company_customer_access(id, true));

drop policy if exists properties_admin_all on public.properties;
drop policy if exists properties_admin_select on public.properties;
drop policy if exists properties_admin_insert on public.properties;
drop policy if exists properties_admin_update on public.properties;
drop policy if exists properties_admin_delete on public.properties;

create policy properties_admin_select
on public.properties
for select
to authenticated
using (
  is_admin()
  and organization_id = app_org_id()
  and public.company_customer_access(customer_id, false)
);

create policy properties_admin_insert
on public.properties
for insert
to authenticated
with check (
  is_admin()
  and organization_id = app_org_id()
  and (company_id is null or company_id = app_org_id())
  and public.company_customer_access(customer_id, true)
);

create policy properties_admin_update
on public.properties
for update
to authenticated
using (
  is_admin()
  and organization_id = app_org_id()
  and public.company_customer_access(customer_id, true)
)
with check (
  is_admin()
  and organization_id = app_org_id()
  and (company_id is null or company_id = app_org_id())
  and public.company_customer_access(customer_id, true)
);

create policy properties_admin_delete
on public.properties
for delete
to authenticated
using (
  is_admin()
  and organization_id = app_org_id()
  and public.company_customer_access(customer_id, true)
);
