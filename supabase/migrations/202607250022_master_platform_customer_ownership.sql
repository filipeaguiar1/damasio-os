begin;

-- Keep the existing acquisition model and add an explicit operational lock.
alter table public.customers
  add column if not exists platform_managed boolean not null default false,
  add column if not exists assigned_by_master_at timestamptz,
  add column if not exists assigned_by_master_id uuid references public.profiles(id) on delete set null;

-- Platform-acquired customers are controlled by Master even after assignment.
update public.customers
set platform_managed = true
where acquisition_source = 'platform';

-- Customers created or referred by a company remain editable by that company.
update public.customers
set platform_managed = false
where acquisition_source in ('company_referral', 'company_created');

-- Leads created by Master are always platform-managed after conversion.
update public.customers c
set acquisition_source = 'platform',
    platform_managed = true
where exists (
  select 1
  from public.lead_center l
  where l.customer_id = c.id
    and l.created_by_master_id is not null
);

create index if not exists customers_platform_managed_company_idx
  on public.customers(platform_managed, service_company_id, created_at desc);

grant select, insert, update on table public.customers to service_role;
grant select, insert, update on table public.properties to service_role;
grant select, update on table public.lead_center to service_role;
grant select on table public.organizations to service_role;

-- The transfer function preserves origin and updates every canonical company pointer.
create or replace function public.master_transfer_customer(
  p_customer_id uuid,
  p_service_company_id uuid,
  p_reason text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master public.profiles%rowtype;
  v_customer public.customers%rowtype;
begin
  select * into v_master
  from public.profiles
  where id = auth.uid();

  if v_master.id is null or v_master.role::text <> 'master' or not coalesce(v_master.active, false) then
    raise exception 'Only an active Master can transfer customers';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if v_customer.id is null then
    raise exception 'Customer not found';
  end if;

  if p_service_company_id is not null and not exists (
    select 1 from public.organizations
    where id = p_service_company_id and active and deleted_at is null
  ) then
    raise exception 'Selected company is not active';
  end if;

  update public.customers
  set previous_service_company_id = service_company_id,
      service_company_id = p_service_company_id,
      company_id = p_service_company_id,
      organization_id = p_service_company_id,
      assignment_status = case
        when p_service_company_id is null and first_payment_at is null then 'pending_payment'
        when p_service_company_id is null then 'ready_for_assignment'
        else 'assigned'
      end,
      last_transfer_at = now(),
      last_transfer_reason = nullif(trim(coalesce(p_reason, '')), ''),
      previous_company_notified_at = null,
      assigned_by_master_at = now(),
      assigned_by_master_id = auth.uid()
  where id = p_customer_id
  returning * into v_customer;

  update public.properties
  set company_id = p_service_company_id,
      organization_id = p_service_company_id,
      updated_at = now()
  where customer_id = p_customer_id;

  update public.jobs
  set company_id = p_service_company_id,
      organization_id = p_service_company_id,
      updated_at = now()
  where customer_id = p_customer_id
    and active = true;

  update public.service_requests
  set company_id = p_service_company_id,
      organization_id = p_service_company_id,
      updated_at = now()
  where customer_id = p_customer_id
    and status not in ('completed', 'cancelled', 'rejected');

  return v_customer;
end;
$$;

revoke all on function public.master_transfer_customer(uuid,uuid,text) from public, anon;
grant execute on function public.master_transfer_customer(uuid,uuid,text) to authenticated;

commit;
