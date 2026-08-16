begin;

alter table public.invoices
  add column if not exists paid_at timestamptz;

create or replace function public.get_payments_contract_workspace(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_is_master boolean;
  v_company_id uuid;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;

  v_is_master := v_profile.role::text = 'master';
  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);

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
        p_scope = 'company'
        and coalesce(c.acquisition_source, '') <> 'platform'
        and coalesce(c.origin_company_id, c.company_id, c.organization_id) = v_company_id
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
        or (
          p_scope = 'company'
          and coalesce(c.acquisition_source, '') <> 'platform'
          and coalesce(c.origin_company_id, c.company_id, c.organization_id) = v_company_id
          and coalesce(j.company_id, j.organization_id) = v_company_id
        )
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
        or (
          p_scope = 'company'
          and ba.company_id = v_company_id
          and coalesce(ba.customer_origin, '') <> 'platform'
          and coalesce(c.acquisition_source, '') <> 'platform'
        )
      )
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', be.id,
        'visitId', be.visit_id,
        'customerId', be.customer_id,
        'state', be.state,
        'feedbackDeadlineAt', be.feedback_deadline_at,
        'chargedAt', be.charged_at,
        'transferredAt', be.transferred_at
      ) order by be.created_at desc)
      from public.visit_billing_events be
      join public.customers c on c.id = be.customer_id
      where (
        (p_scope = 'master' and c.acquisition_source = 'platform')
        or (
          p_scope = 'company'
          and be.company_id = v_company_id
          and coalesce(c.acquisition_source, '') <> 'platform'
        )
      )
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'customerId', i.customer_id,
        'number', i.invoice_number,
        'status', i.status::text,
        'serviceName', coalesce(q.quote_number, 'Service invoice'),
        'totalCents', (round(coalesce(i.total, 0) * 100))::bigint,
        'createdAt', i.created_at,
        'paidAt', i.paid_at,
        'stripeCheckoutSessionId', i.stripe_checkout_session_id
      ) order by i.created_at desc)
      from public.invoices i
      join public.customers c on c.id = i.customer_id
      left join public.quotes q on q.id = i.quote_id
      where (
        (p_scope = 'master' and c.acquisition_source = 'platform')
        or (
          p_scope = 'company'
          and coalesce(i.company_id, i.organization_id) = v_company_id
          and coalesce(c.acquisition_source, '') <> 'platform'
          and coalesce(c.origin_company_id, c.company_id, c.organization_id) = v_company_id
        )
      )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_payments_contract_workspace(text) from public, anon;
grant execute on function public.get_payments_contract_workspace(text) to authenticated;

commit;
