create unique index if not exists jobs_quote_id_unique
  on public.jobs(quote_id)
  where quote_id is not null;

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

  if v_lead.property_id is not null then
    select p.id into v_property
    from public.properties p
    where p.id=v_lead.property_id
      and p.customer_id=v_customer
      and coalesce(p.company_id,p.organization_id)=v_company;
    if v_property is null then
      raise exception 'Referral Property does not belong to the canonical Customer/company';
    end if;
  elsif nullif(trim(coalesce(v_lead.address,'')),'') is not null then
    insert into public.properties(
      organization_id,company_id,customer_id,address_line1,city,province,country
    ) values(
      v_company,v_company,v_customer,v_lead.address,'Hamilton','ON','Canada'
    ) returning id into v_property;
  end if;

  if v_lead.quote_id is not null then
    update public.quotes
    set customer_id=v_customer,
        property_id=coalesce(v_property,property_id),
        organization_id=v_company,
        company_id=v_company,
        status=case when status='draft' then 'sent'::public.quote_status else status end
    where id=v_lead.quote_id
      and coalesce(company_id,organization_id)=v_company;
  end if;

  if v_lead.service_request_id is not null then
    update public.service_requests
    set status='accepted',
        customer_id=v_customer,
        property_id=coalesce(v_property,property_id),
        organization_id=v_company,
        company_id=v_company
    where id=v_lead.service_request_id
      and coalesce(company_id,organization_id)=v_company;
  end if;

  update public.lead_center
  set customer_id=v_customer,
      property_id=coalesce(v_property,property_id),
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
      'quote_id',v_lead.quote_id,
      'job_created',false,
      'next_step','customer_quote_decision'
    )
  );

  return public.get_company_referral_inbox();
end;
$function$;

create or replace function public.customer_decide_quote(p_quote_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_quote public.quotes%rowtype;
  v_lead_status text;
  v_job uuid;
  v_service text;
  v_frequency public.service_frequency;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select c.* into v_customer
  from public.customers c
  join public.profiles p on p.id=c.profile_id
  where c.profile_id=v_uid
    and c.archived_at is null
    and p.active=true
    and p.role='customer'
  limit 1;

  if v_customer.id is null then
    raise exception 'Customer account is not canonically linked';
  end if;

  select q.* into v_quote
  from public.quotes q
  where q.id=p_quote_id
    and q.customer_id=v_customer.id
    and coalesce(q.company_id,q.organization_id)=coalesce(v_customer.company_id,v_customer.organization_id)
  for update;

  if v_quote.id is null then
    raise exception 'Quote not found for this Customer';
  end if;

  if v_quote.status in ('approved','declined','expired') then
    if (v_quote.status='approved' and p_approve) or (v_quote.status='declined' and not p_approve) then
      select j.id into v_job from public.jobs j where j.quote_id=v_quote.id limit 1;
      return jsonb_build_object('saved',true,'quote_id',v_quote.id,'status',v_quote.status::text,'job_id',v_job,'duplicate',true);
    end if;
    raise exception 'This quote already has a final decision';
  end if;

  if v_quote.status <> 'sent' then
    raise exception 'Only a sent quote can be decided';
  end if;

  select l.status into v_lead_status
  from public.lead_center l
  where l.quote_id=v_quote.id
  order by l.created_at desc
  limit 1;

  if v_lead_status is not null and v_lead_status <> 'converted' then
    raise exception 'The service company must accept this referral before the quote can be approved';
  end if;

  if not p_approve then
    update public.quotes
    set status='declined',customer_decided_at=now()
    where id=v_quote.id;

    if v_quote.request_id is not null then
      update public.service_requests set status='declined' where id=v_quote.request_id;
    end if;

    insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
    values(coalesce(v_quote.company_id,v_quote.organization_id),coalesce(v_quote.company_id,v_quote.organization_id),v_uid,
      'Customer declined quote','quote',v_quote.id,'Customer declined quote '||v_quote.quote_number||'.');

    return jsonb_build_object('saved',true,'quote_id',v_quote.id,'status','declined','job_id',null);
  end if;

  update public.quotes
  set status='approved',customer_decided_at=now()
  where id=v_quote.id;

  v_service := coalesce(
    (select nullif(trim(sr.service_name),'') from public.service_requests sr where sr.id=v_quote.request_id),
    nullif(trim(v_quote.notes),''),
    'Approved Service'
  );
  v_frequency := case
    when lower(v_service) like '%biweekly%' or lower(v_service) like '%bi-weekly%' then 'biweekly'::public.service_frequency
    when lower(v_service) like '%monthly%' then 'monthly'::public.service_frequency
    when lower(v_service) like '%weekly%' then 'weekly'::public.service_frequency
    else 'one_time'::public.service_frequency
  end;

  select j.id into v_job
  from public.jobs j
  where j.quote_id=v_quote.id
  limit 1;

  if v_job is null then
    insert into public.jobs(
      organization_id,company_id,customer_id,property_id,quote_id,
      service_name,frequency,service_frequency,active,billing_model
    ) values(
      coalesce(v_quote.company_id,v_quote.organization_id),
      coalesce(v_quote.company_id,v_quote.organization_id),
      v_quote.customer_id,v_quote.property_id,v_quote.id,
      v_service,v_frequency,v_frequency::text,true,'manual'
    ) returning id into v_job;
  end if;

  if v_quote.request_id is not null then
    update public.service_requests set status='accepted' where id=v_quote.request_id;
  end if;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details)
  values(coalesce(v_quote.company_id,v_quote.organization_id),coalesce(v_quote.company_id,v_quote.organization_id),v_uid,
    'Customer approved quote','quote',v_quote.id,'Customer approved quote '||v_quote.quote_number||'; canonical Job created.');

  return jsonb_build_object('saved',true,'quote_id',v_quote.id,'status','approved','job_id',v_job);
end;
$function$;

revoke all on function public.customer_decide_quote(uuid,boolean) from public, anon;
grant execute on function public.customer_decide_quote(uuid,boolean) to authenticated;
