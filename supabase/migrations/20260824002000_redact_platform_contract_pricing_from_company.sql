begin;

-- Company Admins serving a Master/platform customer may see only their own
-- payout plus operational contract timing. Customer price and platform margin
-- are redacted at the database boundary.
create or replace function public.get_payments_contract_workspace(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_is_master boolean;
  v_company uuid;
begin
  select * into v_profile
  from public.profiles
  where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;

  v_is_master:=v_profile.role::text='master';
  v_company:=coalesce(v_profile.company_id,v_profile.organization_id);

  if p_scope='master' and not v_is_master then raise exception 'Master access required'; end if;
  if p_scope='company' and v_profile.role::text not in ('admin','manager') then raise exception 'Company admin access required'; end if;
  if p_scope not in ('master','company') then raise exception 'Invalid payment workspace scope'; end if;
  if p_scope='company' and v_company is null then raise exception 'Company context is required'; end if;
  if p_scope='company' and v_profile.role::text='manager' then
    perform public.require_company_module_permission('finance','view');
  end if;

  return jsonb_build_object(
    'customers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.full_name,'email',c.email,'origin',c.acquisition_source,
        'originCompanyId',c.origin_company_id,'serviceCompanyId',c.service_company_id,
        'assignmentStatus',c.assignment_status,'servicePaymentMethod',c.service_payment_method
      ) order by c.full_name)
      from public.customers c
      where c.archived_at is null and (
        (p_scope='master' and c.acquisition_source='platform')
        or
        (p_scope='company' and (
          (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
          or
          (c.acquisition_source<>'platform' and coalesce(c.company_id,c.organization_id)=v_company)
        ))
      )
    ),'[]'::jsonb),
    'jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',j.id,'customerId',j.customer_id,'propertyId',j.property_id,'serviceName',j.service_name,
        'nextVisitDate',j.next_visit_date,'active',j.active
      ) order by j.created_at desc)
      from public.jobs j
      join public.customers c on c.id=j.customer_id and c.archived_at is null
      where j.active=true and (
        (p_scope='master' and c.acquisition_source='platform')
        or
        (p_scope='company' and (
          (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
          or
          (c.acquisition_source<>'platform' and coalesce(j.company_id,j.organization_id)=v_company)
        ))
      )
    ),'[]'::jsonb),
    'agreements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ba.id,'jobId',ba.job_id,'customerId',ba.customer_id,'customerOrigin',ba.customer_origin,
        'ownerRole',ba.contract_owner_role,'billingModel',ba.billing_model,'collectionTiming',ba.collection_timing,
        'serviceFrequency',ba.service_frequency,
        'customerAmountCents',case when p_scope='company' and c.acquisition_source='platform' then null else ba.customer_amount_cents end,
        'providerPayoutCents',ba.provider_payout_cents,
        'platformFeeBasisPoints',case when p_scope='company' and c.acquisition_source='platform' then null else ba.platform_fee_basis_points end,
        'contractStartsOn',ba.contract_starts_on,'contractEndsOn',ba.contract_ends_on,
        'feedbackWindowHours',ba.feedback_window_hours,'prepaidPlanType',ba.prepaid_plan_type,'active',ba.active
      ) order by ba.active desc,ba.created_at desc)
      from public.billing_agreements ba
      join public.customers c on c.id=ba.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and ba.company_id=v_company)
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',be.id,'visitId',be.visit_id,'customerId',be.customer_id,
        'state',case when p_scope='company' and c.acquisition_source='platform' and be.state in ('charge_failed','payment_failed') then 'payout_pending' else be.state end,
        'feedbackDeadlineAt',be.feedback_deadline_at,'chargedAt',be.charged_at,'transferredAt',be.transferred_at
      ) order by be.created_at desc)
      from public.visit_billing_events be
      join public.customers c on c.id=be.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and be.company_id=v_company)
    ),'[]'::jsonb),
    'invoices',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'customerId',i.customer_id,'propertyId',i.property_id,'number',i.invoice_number,
        'status',i.status::text,'totalCents',round(i.total*100)::bigint,'createdAt',i.created_at,
        'visitId',i.visit_id,'billingEventId',i.billing_event_id,
        'stripeCheckoutSessionId',i.stripe_checkout_session_id,'stripePaymentIntentId',i.stripe_payment_intent_id
      ) order by i.created_at desc)
      from public.invoices i
      join public.customers c on c.id=i.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and i.organization_id=v_company and (
           (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
           or (c.acquisition_source<>'platform' and coalesce(c.company_id,c.organization_id)=v_company)
         ))
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_payments_contract_workspace(text) from public,anon;
grant execute on function public.get_payments_contract_workspace(text) to authenticated,service_role;

commit;
