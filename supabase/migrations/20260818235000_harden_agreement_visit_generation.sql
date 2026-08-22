alter table public.billing_agreements
  drop constraint if exists billing_agreements_custom_frequency_valid;
alter table public.billing_agreements
  add constraint billing_agreements_custom_frequency_valid
  check (
    service_frequency <> 'custom'
    or (
      custom_frequency_interval between 1 and 365
      and custom_frequency_unit in ('day','week','month')
    )
  );

create or replace function public.generate_agreement_visits(
  p_agreement_id uuid,
  p_horizon date default (current_date + 90)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agreement public.billing_agreements%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_profile public.profiles%rowtype;
  v_date date;
  v_horizon date;
  v_step interval;
  v_created integer := 0;
  v_iterations integer := 0;
  v_service_role boolean := auth.role() = 'service_role';
begin
  if not v_service_role then
    select * into v_profile
    from public.profiles
    where id=auth.uid()
      and active=true
    limit 1;

    if v_profile.id is null or v_profile.role::text not in ('admin','manager','master') then
      raise exception 'Active Admin, Manager or Master access required';
    end if;

    if v_profile.role::text='manager' then
      perform public.require_company_module_permission('finance','manage');
    end if;
  end if;

  select * into v_agreement
  from public.billing_agreements
  where id=p_agreement_id
    and active=true;

  if v_agreement.id is null then
    raise exception 'Active agreement not found';
  end if;

  select * into v_job
  from public.jobs
  where id=v_agreement.job_id
    and active=true;
  if v_job.id is null then
    raise exception 'Active agreement Job not found';
  end if;

  select * into v_customer
  from public.customers
  where id=v_agreement.customer_id
    and archived_at is null;
  if v_customer.id is null then
    raise exception 'Agreement Customer is unavailable';
  end if;

  if not v_service_role then
    if v_agreement.contract_owner_role='master'
       and v_profile.role::text<>'master' then
      raise exception 'Only Master can generate this schedule';
    end if;

    if v_agreement.contract_owner_role='company'
       and (
         v_profile.role::text not in ('admin','manager')
         or coalesce(v_profile.company_id,v_profile.organization_id)
            is distinct from coalesce(
              v_customer.origin_company_id,
              v_customer.company_id,
              v_customer.organization_id
            )
       ) then
      raise exception 'Only the owning company can generate this schedule';
    end if;
  end if;

  if p_horizon is not null and p_horizon < current_date then
    raise exception 'Visit generation horizon cannot be in the past';
  end if;
  v_horizon := least(coalesce(p_horizon,current_date+90), current_date+366);

  v_date := greatest(coalesce(v_agreement.contract_starts_on,current_date),current_date);

  if v_agreement.service_frequency='weekly' then
    v_step:=interval '7 days';
  elsif v_agreement.service_frequency='biweekly' then
    v_step:=interval '14 days';
  elsif v_agreement.service_frequency='monthly' then
    v_step:=interval '1 month';
  elsif v_agreement.service_frequency='custom' then
    if v_agreement.custom_frequency_interval is null
       or v_agreement.custom_frequency_interval < 1
       or v_agreement.custom_frequency_interval > 365
       or v_agreement.custom_frequency_unit not in ('day','week','month') then
      raise exception 'Custom service frequency is invalid';
    end if;

    case v_agreement.custom_frequency_unit
      when 'day' then v_step:=make_interval(days=>v_agreement.custom_frequency_interval);
      when 'week' then v_step:=make_interval(weeks=>v_agreement.custom_frequency_interval);
      when 'month' then v_step:=make_interval(months=>v_agreement.custom_frequency_interval);
    end case;
  else
    v_step:=null;
  end if;

  if v_agreement.service_frequency='one_time' then
    if v_date <= v_horizon
       and v_date <= coalesce(v_agreement.contract_ends_on,v_horizon)
       and not exists (
         select 1 from public.visits
         where job_id=v_job.id
           and scheduled_date=v_date
           and status::text<>'cancelled'
       ) then
      insert into public.visits(
        organization_id,company_id,job_id,customer_id,property_id,scheduled_date,status
      ) values (
        coalesce(v_job.organization_id,v_job.company_id),
        coalesce(v_job.company_id,v_job.organization_id),
        v_job.id,v_job.customer_id,v_job.property_id,v_date,'scheduled'
      );
      v_created:=1;
    end if;
    return v_created;
  end if;

  if v_step is null or v_step <= interval '0 seconds' then
    raise exception 'Recurring agreement frequency must advance time';
  end if;

  while v_date <= least(v_horizon,coalesce(v_agreement.contract_ends_on,v_horizon)) loop
    v_iterations:=v_iterations+1;
    if v_iterations>400 then
      raise exception 'Visit generation safety limit exceeded';
    end if;

    if not exists (
      select 1 from public.visits
      where job_id=v_job.id
        and scheduled_date=v_date
        and status::text<>'cancelled'
    ) then
      insert into public.visits(
        organization_id,company_id,job_id,customer_id,property_id,scheduled_date,status
      ) values (
        coalesce(v_job.organization_id,v_job.company_id),
        coalesce(v_job.company_id,v_job.organization_id),
        v_job.id,v_job.customer_id,v_job.property_id,v_date,'scheduled'
      );
      v_created:=v_created+1;
    end if;

    v_date:=(v_date::timestamp+v_step)::date;
  end loop;

  update public.jobs
  set next_visit_date=(
    select min(scheduled_date)
    from public.visits
    where job_id=v_job.id
      and scheduled_date>=current_date
      and status::text='scheduled'
  )
  where id=v_job.id;

  return v_created;
end;
$$;
