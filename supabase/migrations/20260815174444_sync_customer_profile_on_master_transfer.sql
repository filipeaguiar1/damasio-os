create or replace function public.master_transfer_customer(
  p_customer_id uuid,
  p_service_company_id uuid,
  p_reason text default null::text
)
returns public.customers
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_master public.profiles%rowtype;
  v_customer public.customers%rowtype;
begin
  select *
    into v_master
  from public.profiles
  where id = auth.uid();

  if v_master.id is null
     or v_master.role::text <> 'master'
     or not coalesce(v_master.active, false) then
    raise exception 'Only an active Master can transfer customers';
  end if;

  select *
    into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if v_customer.id is null then
    raise exception 'Customer not found';
  end if;

  if p_service_company_id is not null
     and not exists (
       select 1
       from public.organizations
       where id = p_service_company_id
         and active = true
         and deleted_at is null
     ) then
    raise exception 'Selected company is not active';
  end if;

  if v_customer.profile_id is not null then
    update public.profiles
    set company_id = p_service_company_id,
        organization_id = p_service_company_id
    where id = v_customer.profile_id
      and role::text = 'customer'
      and active;

    if not found then
      raise exception 'Linked Customer profile is missing, inactive or not a Customer';
    end if;
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
    and status not in ('completed','cancelled','rejected');

  return v_customer;
end;
$function$;
