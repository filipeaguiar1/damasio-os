alter table public.billing_agreements
  add column if not exists tax_rate_basis_points integer;

alter table public.billing_agreements
  add column if not exists tax_label text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.billing_agreements'::regclass
      and conname='billing_agreements_tax_rate_basis_points_check'
  ) then
    alter table public.billing_agreements
      add constraint billing_agreements_tax_rate_basis_points_check
      check (tax_rate_basis_points is null or (tax_rate_basis_points between 0 and 3000));
  end if;
end
$$;

update public.billing_agreements ba
set tax_rate_basis_points = case upper(trim(p.province))
      when 'ON' then 1300
      when 'NS' then 1400
      when 'NB' then 1500
      when 'NL' then 1500
      when 'PE' then 1500
      when 'AB' then 500
      when 'NT' then 500
      when 'NU' then 500
      when 'YT' then 500
      else ba.tax_rate_basis_points
    end,
    tax_label = case upper(trim(p.province))
      when 'ON' then 'HST'
      when 'NS' then 'HST'
      when 'NB' then 'HST'
      when 'NL' then 'HST'
      when 'PE' then 'HST'
      when 'AB' then 'GST'
      when 'NT' then 'GST'
      when 'NU' then 'GST'
      when 'YT' then 'GST'
      else ba.tax_label
    end,
    updated_at=clock_timestamp()
from public.properties p
where p.id=ba.property_id
  and ba.tax_rate_basis_points is null;

create or replace function public.save_customer_billing_agreement(
  p_job_id uuid,
  p_billing_model text,
  p_collection_timing text,
  p_service_frequency text,
  p_customer_amount_cents bigint,
  p_provider_payout_cents bigint default null,
  p_platform_fee_basis_points integer default null,
  p_contract_starts_on date default current_date,
  p_contract_ends_on date default null,
  p_feedback_window_hours integer default 24,
  p_prepaid_plan_type text default null,
  p_plan_billing_day integer default 1,
  p_service_start_day integer default null,
  p_custom_frequency_interval integer default null,
  p_custom_frequency_unit text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_property public.properties%rowtype;
  v_owner_role text;
  v_next_version integer;
  v_agreement_id uuid;
  v_fee_bps integer := p_platform_fee_basis_points;
  v_tax_bps integer;
  v_tax_label text;
  v_province text;
begin
  select * into v_profile
  from public.profiles
  where id=auth.uid() and active=true;

  if v_profile.id is null then
    raise exception 'Authentication required';
  end if;

  if v_profile.role::text='manager' then
    perform public.require_company_module_permission('finance','manage');
  end if;

  select * into v_job
  from public.jobs
  where id=p_job_id and active=true;

  if v_job.id is null then
    raise exception 'Active job not found';
  end if;

  select * into v_customer
  from public.customers
  where id=v_job.customer_id and archived_at is null;

  if v_customer.id is null then
    raise exception 'Customer not found';
  end if;

  if v_job.property_id is not null then
    select * into v_property
    from public.properties
    where id=v_job.property_id;
  end if;

  if v_customer.acquisition_source='platform' then
    if v_profile.role::text<>'master' then
      raise exception 'Only Master can define a platform customer contract';
    end if;
    v_owner_role:='master';
  else
    if v_profile.role::text not in('admin','manager')
      or coalesce(v_profile.company_id,v_profile.organization_id)
        is distinct from coalesce(v_customer.origin_company_id,v_customer.company_id,v_customer.organization_id)
    then
      raise exception 'Only the owning company can define this customer contract';
    end if;
    v_owner_role:='company';
  end if;

  if p_service_frequency not in('one_time','weekly','biweekly','monthly','custom') then
    raise exception 'Invalid service frequency';
  end if;

  if p_feedback_window_hours<1 or p_feedback_window_hours>168 then
    raise exception 'Invalid feedback window';
  end if;

  if p_customer_amount_cents is null or p_customer_amount_cents<50 then
    raise exception 'Customer amount must be at least 50 cents';
  end if;

  if p_contract_ends_on is not null and p_contract_ends_on<p_contract_starts_on then
    raise exception 'Contract end date cannot be before start date';
  end if;

  if p_collection_timing='after_visit' then
    if p_billing_model not in('per_visit_fixed_payout','per_visit_percentage_fee') then
      raise exception 'After-visit collection requires a per-visit billing model';
    end if;
  elsif p_collection_timing='manual' then
    if p_billing_model<>'manual' then
      raise exception 'Manual collection requires the manual billing model';
    end if;
  elsif p_collection_timing='period_prepaid' then
    raise exception 'Automated prepaid billing is not enabled yet; use manual collection until billing cycles are validated';
  else
    raise exception 'Invalid collection timing';
  end if;

  if p_billing_model='per_visit_fixed_payout' then
    if p_provider_payout_cents is null
      or p_provider_payout_cents<0
      or p_provider_payout_cents>p_customer_amount_cents
    then
      raise exception 'Fixed company payout must be between zero and the customer amount';
    end if;
  elsif p_billing_model='per_visit_percentage_fee' then
    if v_fee_bps is null then
      select round(pfr.percentage*100)::integer
      into v_fee_bps
      from public.platform_fee_rules pfr
      where pfr.active and pfr.fee_type='percentage'
      order by pfr.created_at desc
      limit 1;
    end if;

    if v_fee_bps is null or v_fee_bps<0 or v_fee_bps>10000 then
      raise exception 'A valid platform percentage fee is required';
    end if;
  end if;

  v_province:=upper(trim(coalesce(v_property.province,'')));
  case v_province
    when 'ON' then v_tax_bps:=1300; v_tax_label:='HST';
    when 'NS' then v_tax_bps:=1400; v_tax_label:='HST';
    when 'NB' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'NL' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'PE' then v_tax_bps:=1500; v_tax_label:='HST';
    when 'AB' then v_tax_bps:=500; v_tax_label:='GST';
    when 'NT' then v_tax_bps:=500; v_tax_label:='GST';
    when 'NU' then v_tax_bps:=500; v_tax_label:='GST';
    when 'YT' then v_tax_bps:=500; v_tax_label:='GST';
    else v_tax_bps:=null; v_tax_label:=null;
  end case;

  if p_collection_timing<>'manual' and v_tax_bps is null then
    raise exception 'Automated billing tax configuration is not available for property province %; use manual collection',
      coalesce(nullif(v_province,''),'unknown');
  end if;

  select coalesce(max(version),0)+1
  into v_next_version
  from public.billing_agreements
  where job_id=p_job_id;

  update public.billing_agreements
  set active=false,updated_at=clock_timestamp()
  where job_id=p_job_id and active=true;

  insert into public.billing_agreements(
    company_id,customer_id,property_id,quote_id,job_id,customer_origin,
    contract_owner_role,created_by_profile_id,billing_model,collection_timing,
    service_frequency,custom_frequency_interval,custom_frequency_unit,
    customer_amount_cents,provider_payout_cents,platform_fee_basis_points,
    currency,feedback_window_hours,contract_starts_on,contract_ends_on,
    prepaid_plan_type,plan_billing_day,service_start_day,version,active,
    tax_rate_basis_points,tax_label,ownership_type,payment_status
  ) values(
    coalesce(v_customer.service_company_id,v_job.company_id,v_job.organization_id),
    v_customer.id,v_job.property_id,v_job.quote_id,v_job.id,
    case when v_customer.acquisition_source='platform' then 'platform' else 'company' end,
    v_owner_role,v_profile.id,p_billing_model,p_collection_timing,p_service_frequency,
    p_custom_frequency_interval,p_custom_frequency_unit,p_customer_amount_cents,
    p_provider_payout_cents,v_fee_bps,'cad',p_feedback_window_hours,
    p_contract_starts_on,p_contract_ends_on,null,p_plan_billing_day,
    p_service_start_day,v_next_version,true,v_tax_bps,v_tax_label,
    case when v_owner_role='master' then 'master' else 'company' end,
    'active'
  ) returning id into v_agreement_id;

  update public.jobs
  set service_frequency=p_service_frequency,
      billing_model=p_billing_model,
      contract_starts_on=p_contract_starts_on,
      contract_ends_on=p_contract_ends_on,
      feedback_window_hours=p_feedback_window_hours,
      prepaid_plan_type=null,
      plan_billing_day=p_plan_billing_day,
      service_start_day=p_service_start_day
  where id=p_job_id;

  return v_agreement_id;
end;
$function$;
