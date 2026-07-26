begin;

alter table public.billing_agreements
  add column if not exists contract_owner_role text not null default 'master'
    check (contract_owner_role in ('master','company')),
  add column if not exists created_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists service_frequency text not null default 'one_time'
    check (service_frequency in ('one_time','weekly','biweekly','monthly','custom')),
  add column if not exists custom_frequency_interval integer
    check (custom_frequency_interval is null or custom_frequency_interval > 0),
  add column if not exists custom_frequency_unit text
    check (custom_frequency_unit is null or custom_frequency_unit in ('day','week','month'));

create or replace function public.get_employee_route_for_date(p_route_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
begin
  select e.* into v_employee
  from public.employees e
  where e.profile_id = auth.uid()
    and e.active = true
  limit 1;

  if v_employee.id is null then
    return jsonb_build_object('routeId', null, 'stops', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'routeId', (
      select v.route_id
      from public.visits v
      where v.organization_id = v_employee.organization_id
        and v.scheduled_date = p_route_date
        and (
          v.assigned_employee_id = v_employee.id
          or (
            v.assigned_employee_id is null
            and v_employee.crew_id is not null
            and v.crew_id = v_employee.crew_id
          )
        )
        and v.status::text not in ('cancelled','missed')
        and v.route_id is not null
      order by v.created_at desc
      limit 1
    ),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visitId', v.id,
        'propertyId', v.property_id,
        'addressLine1', p.address_line1,
        'latitude', p.latitude,
        'longitude', p.longitude,
        'routeOrder', v.route_order,
        'status', v.status::text,
        'customerName', c.full_name,
        'serviceName', j.service_name,
        'scheduledDate', v.scheduled_date,
        'startedAt', v.started_at,
        'finishedAt', v.finished_at,
        'durationSeconds', v.duration_seconds,
        'assignmentType', case when v.assigned_employee_id = v_employee.id then 'employee' else 'crew' end
      ) order by coalesce(v.route_order, 9999), v.created_at)
      from public.visits v
      left join public.properties p on p.id = v.property_id
      left join public.customers c on c.id = v.customer_id
      left join public.jobs j on j.id = v.job_id
      where v.organization_id = v_employee.organization_id
        and v.scheduled_date = p_route_date
        and (
          v.assigned_employee_id = v_employee.id
          or (
            v.assigned_employee_id is null
            and v_employee.crew_id is not null
            and v.crew_id = v_employee.crew_id
          )
        )
        and v.status::text not in ('cancelled','missed')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_employee_route_for_date(date) from public, anon;
grant execute on function public.get_employee_route_for_date(date) to authenticated;

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
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_customer public.customers%rowtype;
  v_owner_role text;
  v_next_version integer;
  v_agreement_id uuid;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;

  select * into v_job from public.jobs where id = p_job_id and active = true;
  if v_job.id is null then raise exception 'Active job not found'; end if;

  select * into v_customer from public.customers where id = v_job.customer_id;
  if v_customer.id is null then raise exception 'Customer not found'; end if;

  if v_customer.acquisition_source = 'platform' then
    if v_profile.role::text <> 'master' then
      raise exception 'Only Master can define a platform customer contract';
    end if;
    v_owner_role := 'master';
  else
    if v_profile.role::text not in ('admin','manager')
       or v_profile.organization_id is distinct from coalesce(v_customer.origin_company_id, v_customer.organization_id) then
      raise exception 'Only the owning company can define this customer contract';
    end if;
    v_owner_role := 'company';
  end if;

  if p_service_frequency not in ('one_time','weekly','biweekly','monthly','custom') then
    raise exception 'Invalid service frequency';
  end if;
  if p_feedback_window_hours < 1 or p_feedback_window_hours > 168 then
    raise exception 'Invalid feedback window';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.billing_agreements
  where job_id = p_job_id;

  update public.billing_agreements
  set active = false, updated_at = now()
  where job_id = p_job_id and active = true;

  insert into public.billing_agreements (
    company_id, customer_id, property_id, quote_id, job_id,
    customer_origin, contract_owner_role, created_by_profile_id,
    billing_model, collection_timing, service_frequency,
    custom_frequency_interval, custom_frequency_unit,
    customer_amount_cents, provider_payout_cents,
    platform_fee_basis_points, currency, feedback_window_hours,
    contract_starts_on, contract_ends_on, prepaid_plan_type,
    plan_billing_day, service_start_day, version, active
  ) values (
    coalesce(v_customer.service_company_id, v_job.organization_id),
    v_customer.id, v_job.property_id, v_job.quote_id, v_job.id,
    case when v_customer.acquisition_source = 'platform' then 'platform' else 'company' end,
    v_owner_role, v_profile.id,
    p_billing_model, p_collection_timing, p_service_frequency,
    p_custom_frequency_interval, p_custom_frequency_unit,
    p_customer_amount_cents, p_provider_payout_cents,
    p_platform_fee_basis_points, 'cad', p_feedback_window_hours,
    p_contract_starts_on, p_contract_ends_on, p_prepaid_plan_type,
    p_plan_billing_day, p_service_start_day, v_next_version, true
  ) returning id into v_agreement_id;

  update public.jobs
  set service_frequency = p_service_frequency,
      billing_model = p_billing_model,
      contract_starts_on = p_contract_starts_on,
      contract_ends_on = p_contract_ends_on,
      feedback_window_hours = p_feedback_window_hours,
      prepaid_plan_type = p_prepaid_plan_type,
      plan_billing_day = p_plan_billing_day,
      service_start_day = p_service_start_day
  where id = p_job_id;

  return v_agreement_id;
end;
$$;

revoke all on function public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text) from public, anon;
grant execute on function public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text) to authenticated;

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
  v_step interval;
  v_created integer := 0;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  select * into v_agreement from public.billing_agreements where id = p_agreement_id and active = true;
  if v_agreement.id is null then raise exception 'Active agreement not found'; end if;
  select * into v_job from public.jobs where id = v_agreement.job_id;
  select * into v_customer from public.customers where id = v_agreement.customer_id;

  if v_agreement.contract_owner_role = 'master' and v_profile.role::text <> 'master' then
    raise exception 'Only Master can generate this schedule';
  end if;
  if v_agreement.contract_owner_role = 'company' and (
    v_profile.role::text not in ('admin','manager') or
    v_profile.organization_id is distinct from coalesce(v_customer.origin_company_id, v_customer.organization_id)
  ) then
    raise exception 'Only the owning company can generate this schedule';
  end if;

  v_date := greatest(coalesce(v_agreement.contract_starts_on, current_date), current_date);
  if v_agreement.service_frequency = 'weekly' then v_step := interval '7 days';
  elsif v_agreement.service_frequency = 'biweekly' then v_step := interval '14 days';
  elsif v_agreement.service_frequency = 'monthly' then v_step := interval '1 month';
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'day' then v_step := make_interval(days => v_agreement.custom_frequency_interval);
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'week' then v_step := make_interval(weeks => v_agreement.custom_frequency_interval);
  elsif v_agreement.service_frequency = 'custom' and v_agreement.custom_frequency_unit = 'month' then v_step := make_interval(months => v_agreement.custom_frequency_interval);
  else v_step := null;
  end if;

  if v_agreement.service_frequency = 'one_time' then
    if not exists (select 1 from public.visits where job_id = v_job.id and scheduled_date = v_date and status::text <> 'cancelled') then
      insert into public.visits (organization_id, job_id, customer_id, property_id, scheduled_date, status)
      values (v_job.organization_id, v_job.id, v_job.customer_id, v_job.property_id, v_date, 'scheduled');
      v_created := 1;
    end if;
    return v_created;
  end if;

  while v_date <= least(p_horizon, coalesce(v_agreement.contract_ends_on, p_horizon)) loop
    if not exists (select 1 from public.visits where job_id = v_job.id and scheduled_date = v_date and status::text <> 'cancelled') then
      insert into public.visits (organization_id, job_id, customer_id, property_id, scheduled_date, status)
      values (v_job.organization_id, v_job.id, v_job.customer_id, v_job.property_id, v_date, 'scheduled');
      v_created := v_created + 1;
    end if;
    v_date := (v_date::timestamp + v_step)::date;
  end loop;

  update public.jobs
  set next_visit_date = (
    select min(scheduled_date) from public.visits
    where job_id = v_job.id and scheduled_date >= current_date and status::text = 'scheduled'
  )
  where id = v_job.id;

  return v_created;
end;
$$;

revoke all on function public.generate_agreement_visits(uuid,date) from public, anon;
grant execute on function public.generate_agreement_visits(uuid,date) to authenticated;

create or replace function public.get_payments_contract_workspace(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_is_master boolean;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;
  v_is_master := v_profile.role::text = 'master';

  if p_scope = 'master' and not v_is_master then raise exception 'Master access required'; end if;
  if p_scope = 'company' and v_profile.role::text not in ('admin','manager') then raise exception 'Company admin access required'; end if;

  return jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.full_name,
        'email', c.email,
        'origin', c.acquisition_source,
        'originCompanyId', c.origin_company_id,
        'serviceCompanyId', c.service_company_id,
        'assignmentStatus', c.assignment_status
      ) order by c.full_name)
      from public.customers c
      where (
        p_scope = 'master' and c.acquisition_source = 'platform'
      ) or (
        p_scope = 'company' and (
          c.service_company_id = v_profile.organization_id
          or c.organization_id = v_profile.organization_id
        )
      )
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id,
        'customerId', j.customer_id,
        'propertyId', j.property_id,
        'serviceName', j.service_name,
        'nextVisitDate', j.next_visit_date,
        'active', j.active
      ) order by j.created_at desc)
      from public.jobs j
      join public.customers c on c.id = j.customer_id
      where j.active = true and (
        (p_scope = 'master' and c.acquisition_source = 'platform')
        or (p_scope = 'company' and (c.service_company_id = v_profile.organization_id or j.organization_id = v_profile.organization_id))
      )
    ), '[]'::jsonb),
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ba.id,
        'jobId', ba.job_id,
        'customerId', ba.customer_id,
        'customerOrigin', ba.customer_origin,
        'ownerRole', ba.contract_owner_role,
        'billingModel', ba.billing_model,
        'collectionTiming', ba.collection_timing,
        'serviceFrequency', ba.service_frequency,
        'customerAmountCents', ba.customer_amount_cents,
        'providerPayoutCents', ba.provider_payout_cents,
        'platformFeeBasisPoints', ba.platform_fee_basis_points,
        'contractStartsOn', ba.contract_starts_on,
        'contractEndsOn', ba.contract_ends_on,
        'feedbackWindowHours', ba.feedback_window_hours,
        'prepaidPlanType', ba.prepaid_plan_type,
        'active', ba.active
      ) order by ba.active desc, ba.created_at desc)
      from public.billing_agreements ba
      join public.customers c on c.id = ba.customer_id
      where (
        (p_scope = 'master' and c.acquisition_source = 'platform')
        or (p_scope = 'company' and ba.company_id = v_profile.organization_id)
      )
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', be.id,
        'visitId', be.visit_id,
        'customerId', be.customer_id,
        'state', case
          when p_scope = 'company' and c.acquisition_source = 'platform' and be.state in ('charge_failed','payment_failed') then 'payout_pending'
          else be.state
        end,
        'feedbackDeadlineAt', be.feedback_deadline_at,
        'chargedAt', be.charged_at,
        'transferredAt', be.transferred_at
      ) order by be.created_at desc)
      from public.visit_billing_events be
      join public.customers c on c.id = be.customer_id
      where (
        (p_scope = 'master' and c.acquisition_source = 'platform')
        or (p_scope = 'company' and be.company_id = v_profile.organization_id)
      )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_payments_contract_workspace(text) from public, anon;
grant execute on function public.get_payments_contract_workspace(text) to authenticated;

commit;
