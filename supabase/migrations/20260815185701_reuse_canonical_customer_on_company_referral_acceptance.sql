create or replace function public.respond_company_referral(p_lead_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid := coalesce(public.current_company_id(),'00000000-0000-0000-0000-000000000001'::uuid);
  v_lead public.lead_center%rowtype;
  v_customer uuid;
  v_property uuid;
  v_job uuid;
  v_frequency public.service_frequency;
  v_service text;
begin
  perform public.require_company_module_permission('customers','manage');

  select * into v_lead
  from public.lead_center
  where id=p_lead_id
    and assigned_company_id=v_company
    and status='offered'
  for update;

  if v_lead.id is null then
    raise exception 'Referral is unavailable or already answered';
  end if;

  if not p_accept then
    update public.lead_center
    set status='declined', updated_at=now()
    where id=p_lead_id;
    return public.get_company_referral_inbox();
  end if;

  v_service := coalesce(nullif(trim(v_lead.service_requested),''),'Property Service');
  v_frequency := case
    when lower(v_service) like '%biweekly%' or lower(v_service) like '%bi-weekly%' then 'biweekly'::public.service_frequency
    when lower(v_service) like '%monthly%' then 'monthly'::public.service_frequency
    when lower(v_service) like '%weekly%' then 'weekly'::public.service_frequency
    else 'one_time'::public.service_frequency
  end;

  -- Master quote responses already create/link the canonical Customer. Reuse it
  -- instead of creating a second Customer when the company accepts the referral.
  if v_lead.customer_id is not null then
    select c.id into v_customer
    from public.customers c
    where c.id=v_lead.customer_id
      and c.archived_at is null
      and coalesce(c.company_id,c.organization_id)=v_company;
    if v_customer is null then
      raise exception 'Referral Customer does not belong to the assigned company';
    end if;
  else
    insert into public.customers(
      organization_id,company_id,full_name,email,phone,notes,
      source_master_profile_id,source_lead_id
    ) values(
      v_company,v_company,v_lead.full_name,v_lead.email,v_lead.phone,v_lead.notes,
      v_lead.created_by_master_id,v_lead.id
    ) returning id into v_customer;
  end if;

  -- Reuse the canonical Property created by Master. Legacy referrals without a
  -- linked Property still get one here.
  if v_lead.property_id is not null then
    select p.id into v_property
    from public.properties p
    where p.id=v_lead.property_id
      and p.customer_id=v_customer
      and coalesce(p.company_id,p.organization_id)=v_company;
    if v_property is null then
      raise exception 'Referral Property does not belong to the canonical Customer/company';
    end if;
  else
    insert into public.properties(
      organization_id,company_id,customer_id,address_line1,city,province,country
    ) values(
      v_company,v_company,v_customer,
      coalesce(nullif(trim(v_lead.address),''),'Address pending'),
      'Hamilton','ON','Canada'
    ) returning id into v_property;
  end if;

  -- If this referral was already materialized into a Job by a compatible path,
  -- reuse that Job. Otherwise create exactly one canonical Job and preserve the
  -- quote/invoice links created by Master.
  if v_lead.quote_id is not null then
    select j.id into v_job
    from public.jobs j
    where coalesce(j.company_id,j.organization_id)=v_company
      and j.quote_id=v_lead.quote_id
    order by j.created_at asc
    limit 1;
  end if;

  if v_job is null and v_lead.invoice_id is not null then
    select j.id into v_job
    from public.jobs j
    where coalesce(j.company_id,j.organization_id)=v_company
      and j.invoice_id=v_lead.invoice_id
    order by j.created_at asc
    limit 1;
  end if;

  if v_job is null then
    insert into public.jobs(
      organization_id,company_id,customer_id,property_id,quote_id,invoice_id,
      service_name,frequency,service_frequency,active
    ) values(
      v_company,v_company,v_customer,v_property,v_lead.quote_id,v_lead.invoice_id,
      v_service,v_frequency,v_frequency::text,true
    ) returning id into v_job;
  end if;

  if v_lead.service_request_id is not null then
    update public.service_requests
    set status='accepted',
        customer_id=v_customer,
        property_id=v_property,
        organization_id=v_company,
        company_id=v_company
    where id=v_lead.service_request_id
      and coalesce(company_id,organization_id)=v_company;
  end if;

  update public.lead_center
  set customer_id=v_customer,
      property_id=v_property,
      status='converted',
      accepted_at=now(),
      updated_at=now()
  where id=p_lead_id;

  insert into public.master_audit_log(
    master_profile_id,company_id,action,entity_type,entity_id,details
  ) values(
    v_lead.created_by_master_id,v_company,'lead.accepted_by_company','lead_center',v_lead.id,
    jsonb_build_object(
      'customer_id',v_customer,
      'property_id',v_property,
      'job_id',v_job,
      'quote_id',v_lead.quote_id,
      'invoice_id',v_lead.invoice_id,
      'canonical_reuse',true
    )
  );

  return public.get_company_referral_inbox();
end;
$function$;
