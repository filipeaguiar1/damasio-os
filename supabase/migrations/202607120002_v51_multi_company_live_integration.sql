-- Damasio OS V51.0.4 — Multi Company Live Integration
begin;

-- Canonical company_id is added without removing the legacy organization_id yet.
do $$
declare t text;
begin
  foreach t in array array['customers','crews','employees','properties','service_requests','quotes','invoices','payments','jobs','routes','visits','tasks','photos','feedback','activity_log'] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.organizations(id) on delete cascade',t);
    execute format('update public.%I set company_id = organization_id where company_id is null',t);
    execute format('create index if not exists %I on public.%I(company_id)', 'idx_'||t||'_company_id', t);
  end loop;
end $$;

-- Atomic Lead Center conversion: Lead -> Customer -> Property.
create or replace function public.master_convert_lead_to_customer(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lead public.lead_center%rowtype;
  v_customer uuid;
  v_property uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='master' and active) then
    raise exception 'Master access required';
  end if;
  select * into v_lead from public.lead_center where id=p_lead_id for update;
  if v_lead.id is null then raise exception 'Lead not found'; end if;
  if v_lead.assigned_company_id is null then raise exception 'Lead must be assigned to a company'; end if;
  if v_lead.status='converted' then raise exception 'Lead already converted'; end if;

  insert into public.customers(organization_id,company_id,full_name,email,phone,notes)
  values(v_lead.assigned_company_id,v_lead.assigned_company_id,v_lead.full_name,v_lead.email,v_lead.phone,v_lead.notes)
  returning id into v_customer;

  if coalesce(trim(v_lead.address),'')<>'' then
    insert into public.properties(organization_id,company_id,customer_id,address_line1,city,province,country)
    values(v_lead.assigned_company_id,v_lead.assigned_company_id,v_customer,v_lead.address,'Hamilton','ON','Canada')
    returning id into v_property;
  end if;

  update public.lead_center set status='converted',accepted_at=now(),updated_at=now() where id=p_lead_id;
  insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(auth.uid(),v_lead.assigned_company_id,'lead.converted','lead_center',p_lead_id,jsonb_build_object('customer_id',v_customer,'property_id',v_property));
  return jsonb_build_object('customer_id',v_customer,'property_id',v_property);
end $$;

-- Company-scoped helper used by new repositories during the transition.
create or replace function public.current_company_id() returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(company_id,organization_id) from public.profiles where id=auth.uid() and active limit 1
$$;

commit;
