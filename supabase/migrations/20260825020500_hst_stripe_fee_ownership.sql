-- Canonical Canadian tax + Stripe processing ownership.
-- Service prices are pre-tax. Tax is added to the customer charge.
-- Company-owned customer: company owns tax and absorbs Stripe processing fee.
-- Platform/Master-owned customer: Master owns tax and absorbs Stripe processing fee.
begin;

alter table public.invoices
  add column if not exists tax_rate_basis_points integer,
  add column if not exists tax_label text,
  add column if not exists ownership_type text,
  add column if not exists stripe_processing_fee numeric(12,2) not null default 0,
  add column if not exists stripe_fee_responsibility text;

alter table public.company_payout_items
  add column if not exists service_amount numeric(12,2) not null default 0,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists stripe_processing_fee numeric(12,2) not null default 0,
  add column if not exists gross_entitlement numeric(12,2) not null default 0,
  add column if not exists ownership_type text;

alter table public.master_balance_entries
  drop constraint if exists master_balance_entries_amount_cents_check,
  add column if not exists service_revenue_cents bigint not null default 0,
  add column if not exists tax_cents bigint not null default 0,
  add column if not exists stripe_processing_fee_cents bigint not null default 0,
  add column if not exists gross_entitlement_cents bigint not null default 0,
  add column if not exists ownership_type text;

alter table public.master_balance_entry_events
  drop constraint if exists master_balance_entry_events_amount_cents_check;

-- Existing quotes already calculate Ontario HST correctly. Keep the customer-facing
-- quote amount as subtotal and tax separately rather than treating total as the service price.

create or replace function public.materialize_visit_billing_invoice(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event public.visit_billing_events%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_invoice_id uuid;
  v_total numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_tax_rate numeric;
  v_number text;
begin
  select * into v_event
  from public.visit_billing_events
  where id=p_event_id
  for update;

  if v_event.id is null or v_event.state<>'release_pending' then return null; end if;

  select * into v_agreement
  from public.billing_agreements
  where id=v_event.billing_agreement_id
    and active
    and payment_status='active';
  if v_agreement.id is null then return null; end if;
  if coalesce(v_agreement.customer_amount_cents,0)<50 then
    raise exception 'Billing agreement has no chargeable customer amount';
  end if;
  if v_agreement.tax_rate_basis_points is null then
    raise exception 'Billing agreement has no verified tax rate';
  end if;

  select id into v_invoice_id
  from public.invoices
  where billing_event_id=v_event.id
  limit 1;
  if v_invoice_id is not null then return v_invoice_id; end if;

  -- customer_amount_cents is the service price BEFORE tax.
  v_subtotal:=round(v_agreement.customer_amount_cents::numeric/100,2);
  v_tax_rate:=v_agreement.tax_rate_basis_points::numeric/10000;
  v_tax:=round(v_subtotal*v_tax_rate,2);
  v_total:=round(v_subtotal+v_tax,2);
  v_number:='INV-VIS-'||upper(substr(replace(v_event.id::text,'-',''),1,12));

  insert into public.invoices(
    organization_id,quote_id,customer_id,property_id,invoice_number,status,
    subtotal,tax,total,visit_id,billing_event_id,
    tax_rate_basis_points,tax_label,ownership_type,stripe_fee_responsibility
  ) values(
    v_event.company_id,v_agreement.quote_id,v_event.customer_id,v_event.property_id,
    v_number,'waiting_payment',v_subtotal,v_tax,v_total,v_event.visit_id,v_event.id,
    v_agreement.tax_rate_basis_points,v_agreement.tax_label,v_agreement.ownership_type,
    case when v_agreement.ownership_type='master' then 'master' else 'company' end
  )
  on conflict do nothing
  returning id into v_invoice_id;

  if v_invoice_id is null then
    select id into v_invoice_id from public.invoices where billing_event_id=v_event.id limit 1;
  end if;
  return v_invoice_id;
end;
$$;

create or replace function public.materialize_due_monthly_billing_cycles(
  p_reference_date date default current_date,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_agreement record;
  v_cycle record;
  v_generated integer:=0;
  v_invoices integer:=0;
  v_invoice_id uuid;
  v_total numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_rate numeric;
  v_number text;
begin
  for v_agreement in
    select id
    from public.billing_agreements
    where active=true
      and payment_status='active'
      and collection_timing='period_prepaid'
      and billing_model='monthly_fixed_subscription'
      and coalesce(prepaid_plan_type,'monthly')='monthly'
      and (contract_starts_on is null or contract_starts_on<=date_trunc('month',p_reference_date)::date+interval '1 month - 1 day')
      and (contract_ends_on is null or contract_ends_on>=date_trunc('month',p_reference_date)::date)
    order by created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    if public.materialize_monthly_billing_cycle(v_agreement.id,p_reference_date) is not null then
      v_generated:=v_generated+1;
    end if;
  end loop;

  for v_cycle in
    select bc.*,ba.quote_id,ba.tax_rate_basis_points,ba.tax_label,ba.ownership_type
    from public.billing_cycles bc
    join public.billing_agreements ba on ba.id=bc.billing_agreement_id
    left join public.invoices i on i.billing_cycle_id=bc.id
    where bc.cycle_type='monthly'
      and bc.charge_due_on<=p_reference_date
      and bc.state in('scheduled','invoice_pending','payment_failed')
      and i.id is null
    order by bc.charge_due_on,bc.created_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    if v_cycle.tax_rate_basis_points is null then
      update public.billing_cycles
      set state='payment_failed',last_error='Verified tax rate is missing.',updated_at=clock_timestamp()
      where id=v_cycle.id;
      continue;
    end if;

    -- billing_cycles.amount_cents is the service price BEFORE tax.
    v_subtotal:=round(v_cycle.amount_cents::numeric/100,2);
    v_rate:=v_cycle.tax_rate_basis_points::numeric/10000;
    v_tax:=round(v_subtotal*v_rate,2);
    v_total:=round(v_subtotal+v_tax,2);
    v_number:='INV-'||to_char(v_cycle.period_starts_on,'YYYYMM')||'-'||upper(substr(replace(v_cycle.id::text,'-',''),1,8));

    insert into public.invoices(
      organization_id,quote_id,customer_id,property_id,invoice_number,status,
      subtotal,tax,total,billing_cycle_id,
      tax_rate_basis_points,tax_label,ownership_type,stripe_fee_responsibility
    ) values(
      v_cycle.company_id,v_cycle.quote_id,v_cycle.customer_id,v_cycle.property_id,
      v_number,'waiting_payment',v_subtotal,v_tax,v_total,v_cycle.id,
      v_cycle.tax_rate_basis_points,v_cycle.tax_label,v_cycle.ownership_type,
      case when v_cycle.ownership_type='master' then 'master' else 'company' end
    )
    on conflict do nothing
    returning id into v_invoice_id;

    if v_invoice_id is null then
      select id into v_invoice_id from public.invoices where billing_cycle_id=v_cycle.id limit 1;
    end if;

    if v_invoice_id is not null then
      update public.billing_cycles
      set state='invoice_pending',last_error=null,updated_at=clock_timestamp()
      where id=v_cycle.id;
      v_invoices:=v_invoices+1;
    end if;
  end loop;

  update public.invoices i
  set status='overdue'
  from public.billing_cycles bc
  where i.billing_cycle_id=bc.id
    and i.status='waiting_payment'
    and bc.charge_due_on<p_reference_date;

  return jsonb_build_object('cycles',v_generated,'invoices',v_invoices,'date',p_reference_date);
end;
$$;

-- Normalize payout terms using SERVICE subtotal, never tax-inclusive total.
create or replace function public.normalize_company_payout_item_terms()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cycle_agreement uuid;
  v_event_agreement uuid;
  v_invoice_visit uuid;
  v_job uuid;
  v_agreement public.billing_agreements%rowtype;
  v_invoice public.invoices%rowtype;
  v_company_service numeric:=0;
  v_master_service numeric:=0;
  v_company_tax numeric:=0;
  v_fee_bps integer:=0;
begin
  if new.invoice_id is null then return new; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null then return new; end if;

  select bc.billing_agreement_id, vbe.billing_agreement_id, i.visit_id
    into v_cycle_agreement, v_event_agreement, v_invoice_visit
  from public.invoices i
  left join public.billing_cycles bc on bc.id=i.billing_cycle_id
  left join public.visit_billing_events vbe on vbe.id=i.billing_event_id
  where i.id=new.invoice_id;

  if coalesce(v_cycle_agreement,v_event_agreement) is not null then
    select * into v_agreement from public.billing_agreements
    where id=coalesce(v_cycle_agreement,v_event_agreement);
  else
    if coalesce(new.visit_id,v_invoice_visit) is not null then
      select v.job_id into v_job from public.visits v
      where v.id=coalesce(new.visit_id,v_invoice_visit)
        and v.customer_id=new.customer_id limit 1;
    end if;
    if v_job is not null then
      select * into v_agreement from public.billing_agreements ba
      where ba.job_id=v_job and ba.active and ba.payment_status='active'
      order by ba.version desc,ba.created_at desc limit 1;
    end if;
  end if;

  if v_agreement.id is null then
    new.transfer_amount:=0;
    new.platform_fee:=round(coalesce(v_invoice.subtotal,0),2);
    new.service_amount:=0;
    new.tax_amount:=0;
    new.gross_entitlement:=0;
    new.ownership_type:=coalesce(v_invoice.ownership_type,'master');
    new.hold_reason:=coalesce(new.hold_reason,'Master reconciliation required: no canonical payout terms.');
    return new;
  end if;

  if coalesce(v_agreement.ownership_type,v_agreement.contract_owner_role)='master' then
    v_company_service:=round(coalesce(v_agreement.provider_payout_cents,0)::numeric/100,2);
    v_company_service:=greatest(0,least(v_company_service,coalesce(v_invoice.subtotal,0)));
    v_master_service:=round(coalesce(v_invoice.subtotal,0)-v_company_service,2);
    v_company_tax:=0;
    new.ownership_type:='master';
  else
    v_fee_bps:=coalesce(v_agreement.platform_fee_basis_points,0);
    v_master_service:=round(coalesce(v_invoice.subtotal,0)*v_fee_bps/10000,2);
    v_company_service:=round(coalesce(v_invoice.subtotal,0)-v_master_service,2);
    v_company_tax:=round(coalesce(v_invoice.tax,0),2);
    new.ownership_type:='company';
  end if;

  new.service_amount:=v_company_service;
  new.tax_amount:=v_company_tax;
  new.stripe_processing_fee:=greatest(0,coalesce(new.stripe_processing_fee,0));
  new.gross_entitlement:=round(v_company_service+v_company_tax,2);
  new.transfer_amount:=round(greatest(0,new.gross_entitlement-new.stripe_processing_fee),2);
  new.platform_fee:=v_master_service;
  return new;
end;
$$;

create or replace function public.reconcile_visit_payment_to_payout()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_event public.visit_billing_events%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_transfer numeric;
  v_master_service numeric;
  v_company_service numeric;
  v_company_tax numeric;
  v_existing uuid;
  v_completed_at timestamptz;
  v_owner text;
begin
  if new.status::text<>'paid' or new.invoice_id is null then return new; end if;
  if new.method::text='credit_card' and nullif(trim(coalesce(new.stripe_payment_intent_id,'')),'') is null then return new; end if;
  if new.method::text not in('credit_card','account_balance') then return new; end if;

  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null or v_invoice.billing_event_id is null then return new; end if;
  select * into v_event from public.visit_billing_events where id=v_invoice.billing_event_id for update;
  if v_event.id is null then raise exception 'Visit billing event not found for paid invoice'; end if;
  select * into v_agreement from public.billing_agreements where id=v_event.billing_agreement_id;
  if v_agreement.id is null then raise exception 'Billing agreement not found for paid Visit'; end if;
  if abs(new.amount-v_invoice.total)>0.009 then raise exception 'Paid amount does not match Visit invoice'; end if;

  v_owner:=coalesce(v_agreement.ownership_type,v_agreement.contract_owner_role,'company');
  if v_owner='master' then
    v_company_service:=round(coalesce(v_agreement.provider_payout_cents,0)::numeric/100,2);
    if v_company_service<0 or v_company_service>v_invoice.subtotal then raise exception 'Billing agreement provider payout is invalid'; end if;
    v_master_service:=round(v_invoice.subtotal-v_company_service,2);
    v_company_tax:=0;
  else
    v_master_service:=round(v_invoice.subtotal*coalesce(v_agreement.platform_fee_basis_points,0)/10000,2);
    v_company_service:=round(v_invoice.subtotal-v_master_service,2);
    v_company_tax:=round(v_invoice.tax,2);
  end if;
  v_transfer:=round(v_company_service+v_company_tax,2);
  v_completed_at:=v_event.visit_completed_at;

  select id into v_existing from public.company_payout_items where payment_id=new.id limit 1;
  if v_existing is null then
    insert into public.company_payout_items(
      company_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,
      amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,
      stripe_transfer_group,service_completed_at,
      service_amount,tax_amount,stripe_processing_fee,gross_entitlement,ownership_type
    ) values(
      v_event.company_id,v_invoice.id,new.id,v_event.job_id,v_event.visit_id,
      v_event.customer_id,v_event.property_id,new.amount,v_master_service,v_transfer,
      'eligible',null,clock_timestamp(),new.stripe_transfer_group,v_completed_at,
      v_company_service,v_company_tax,0,v_transfer,v_owner
    );
  end if;

  update public.invoices set
    stripe_platform_fee=v_master_service,
    stripe_transfer_amount=v_transfer,
    ownership_type=v_owner,
    stripe_fee_responsibility=case when v_owner='master' then 'master' else 'company' end,
    stripe_transfer_group=coalesce(new.stripe_transfer_group,stripe_transfer_group)
  where id=v_invoice.id;

  update public.visit_billing_events set
    state='charged',charged_at=coalesce(charged_at,clock_timestamp()),
    stripe_payment_intent_id=coalesce(stripe_payment_intent_id,new.stripe_payment_intent_id),
    stripe_charge_id=coalesce(stripe_charge_id,new.stripe_charge_id),updated_at=clock_timestamp()
  where id=v_event.id and state in('release_pending','charge_processing','charge_failed','charged');
  return new;
end;
$$;

create or replace function public.reconcile_monthly_payment_to_payout()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_cycle public.billing_cycles%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_transfer numeric;
  v_master_service numeric;
  v_company_service numeric;
  v_company_tax numeric;
  v_owner text;
  v_visit_id uuid;
  v_completed_at timestamptz;
  v_existing uuid;
begin
  if new.invoice_id is null then return new; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null or v_invoice.billing_cycle_id is null then return new; end if;
  select * into v_cycle from public.billing_cycles where id=v_invoice.billing_cycle_id for update;
  if v_cycle.id is null then return new; end if;

  if new.status::text='failed' then
    update public.billing_cycles set state='payment_failed',last_error=coalesce(new.failure_message,'Monthly payment failed.'),updated_at=clock_timestamp() where id=v_cycle.id;
    return new;
  end if;
  if new.status::text<>'paid' then return new; end if;
  if abs(new.amount-v_invoice.total)>0.009 then raise exception 'Paid amount does not match monthly invoice'; end if;

  select * into v_agreement from public.billing_agreements where id=v_cycle.billing_agreement_id;
  if v_agreement.id is null then raise exception 'Billing agreement not found for monthly payment'; end if;
  v_owner:=coalesce(v_agreement.ownership_type,v_agreement.contract_owner_role,'company');

  if v_owner='master' then
    v_company_service:=round(coalesce(v_agreement.provider_payout_cents,0)::numeric/100,2);
    v_company_service:=greatest(0,least(v_company_service,v_invoice.subtotal));
    v_master_service:=round(v_invoice.subtotal-v_company_service,2);
    v_company_tax:=0;
  else
    v_master_service:=round(v_invoice.subtotal*coalesce(v_agreement.platform_fee_basis_points,0)/10000,2);
    v_company_service:=round(v_invoice.subtotal-v_master_service,2);
    v_company_tax:=round(v_invoice.tax,2);
  end if;
  v_transfer:=round(v_company_service+v_company_tax,2);

  select v.id,coalesce(v.finished_at,v.created_at) into v_visit_id,v_completed_at
  from public.visits v
  where v.job_id=v_cycle.job_id and coalesce(v.company_id,v.organization_id)=v_cycle.company_id
    and v.status='completed' and v.scheduled_date between v_cycle.period_starts_on and v_cycle.period_ends_on
  order by v.scheduled_date desc,coalesce(v.finished_at,v.created_at) desc limit 1;

  select id into v_existing from public.company_payout_items where payment_id=new.id limit 1;
  if v_existing is null then
    insert into public.company_payout_items(
      company_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,
      amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,
      stripe_transfer_group,service_completed_at,
      service_amount,tax_amount,stripe_processing_fee,gross_entitlement,ownership_type
    ) values(
      v_cycle.company_id,v_invoice.id,new.id,v_cycle.job_id,v_visit_id,v_cycle.customer_id,v_cycle.property_id,
      new.amount,v_master_service,v_transfer,'pending_feedback',
      case when v_visit_id is null then 'Monthly customer payment received; waiting for a completed service Visit before company payout release.'
           else 'Monthly customer payment received; waiting for Visit feedback/review window.' end,
      null,new.stripe_transfer_group,v_completed_at,
      v_company_service,v_company_tax,0,v_transfer,v_owner
    );
  end if;

  update public.invoices set
    stripe_platform_fee=v_master_service,
    stripe_transfer_amount=v_transfer,
    ownership_type=v_owner,
    stripe_fee_responsibility=case when v_owner='master' then 'master' else 'company' end,
    stripe_transfer_group=coalesce(new.stripe_transfer_group,stripe_transfer_group)
  where id=v_invoice.id;

  update public.billing_cycles set
    state='paid',stripe_payment_intent_id=coalesce(stripe_payment_intent_id,new.stripe_payment_intent_id),
    paid_at=coalesce(paid_at,clock_timestamp()),last_error=null,updated_at=clock_timestamp()
  where id=v_cycle.id;
  return new;
end;
$$;

-- Master balance represents the Master's actual entitlement, including tax only when
-- the customer belongs to the platform. Stripe fee is applied later from the real
-- Stripe balance transaction.
create or replace function public.sync_master_balance_from_payment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_pi text:=nullif(trim(coalesce(new.stripe_payment_intent_id,'')),'');
  v_owner text;
  v_service_cents bigint:=0;
  v_tax_cents bigint:=0;
  v_gross_cents bigint:=0;
begin
  if new.status::text='refunded' then
    update public.master_balance_entries set state='refunded',status_reason='Canonical Stripe payment refunded.',updated_at=now()
    where (payment_id=new.id or (v_pi is not null and stripe_payment_intent_id=v_pi)) and state<>'refunded';
    return new;
  end if;
  if new.status::text not in ('paid','succeeded') or new.invoice_id is null or v_pi is null then return new; end if;

  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null then return new; end if;
  if v_invoice.billing_event_id is not null then
    select ba.* into v_agreement from public.billing_agreements ba
    join public.visit_billing_events e on e.billing_agreement_id=ba.id
    where e.id=v_invoice.billing_event_id limit 1;
  elsif v_invoice.billing_cycle_id is not null then
    select ba.* into v_agreement from public.billing_agreements ba
    join public.billing_cycles c on c.billing_agreement_id=ba.id
    where c.id=v_invoice.billing_cycle_id limit 1;
  end if;

  v_owner:=coalesce(v_agreement.ownership_type,v_agreement.contract_owner_role,v_invoice.ownership_type,'company');
  v_service_cents:=greatest(0,round(coalesce(v_invoice.stripe_platform_fee,0)*100)::bigint);
  if v_service_cents=0 and v_agreement.id is not null then
    if v_owner='master' then
      v_service_cents:=greatest(0,round(coalesce(v_invoice.subtotal,0)*100)::bigint-coalesce(v_agreement.provider_payout_cents,0));
    else
      v_service_cents:=greatest(0,round(round(coalesce(v_invoice.subtotal,0)*coalesce(v_agreement.platform_fee_basis_points,0)/10000,2)*100)::bigint);
    end if;
  end if;
  v_tax_cents:=case when v_owner='master' then greatest(0,round(coalesce(v_invoice.tax,0)*100)::bigint) else 0 end;
  v_gross_cents:=greatest(0,round(coalesce(v_invoice.total,0)*100)::bigint);

  insert into public.master_balance_entries(
    payment_id,invoice_id,company_id,customer_id,stripe_payment_intent_id,stripe_charge_id,currency,
    gross_payment_cents,amount_cents,state,status_reason,
    service_revenue_cents,tax_cents,stripe_processing_fee_cents,gross_entitlement_cents,ownership_type
  ) values(
    new.id,new.invoice_id,v_invoice.organization_id,v_invoice.customer_id,v_pi,
    nullif(trim(coalesce(new.stripe_charge_id,'')),''),'cad',v_gross_cents,
    v_service_cents+v_tax_cents,'available','Master entitlement from canonical paid invoice.',
    v_service_cents,v_tax_cents,0,v_service_cents+v_tax_cents,v_owner
  ) on conflict (stripe_payment_intent_id) do update set
    payment_id=excluded.payment_id,invoice_id=excluded.invoice_id,company_id=excluded.company_id,
    customer_id=excluded.customer_id,stripe_charge_id=coalesce(excluded.stripe_charge_id,public.master_balance_entries.stripe_charge_id),
    gross_payment_cents=excluded.gross_payment_cents,
    service_revenue_cents=excluded.service_revenue_cents,
    tax_cents=excluded.tax_cents,
    gross_entitlement_cents=excluded.gross_entitlement_cents,
    ownership_type=excluded.ownership_type,
    amount_cents=excluded.gross_entitlement_cents-public.master_balance_entries.stripe_processing_fee_cents,
    updated_at=now();
  return new;
end;
$$;

-- Called only after Stripe itself confirms a paid Checkout Session and the actual
-- balance transaction fee is known. Idempotent by PaymentIntent/invoice.
create or replace function public.apply_stripe_processing_fee(
  p_invoice_id uuid,
  p_payment_intent_id text,
  p_charge_id text,
  p_fee_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_item public.company_payout_items%rowtype;
  v_owner text;
  v_fee numeric;
  v_company_net numeric;
  v_master_amount bigint;
begin
  if p_invoice_id is null or nullif(trim(coalesce(p_payment_intent_id,'')),'') is null then raise exception 'Invoice and PaymentIntent are required'; end if;
  if p_fee_cents is null or p_fee_cents<0 then raise exception 'Stripe fee cannot be negative'; end if;

  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Invoice not found'; end if;
  if nullif(trim(coalesce(v_invoice.stripe_payment_intent_id,'')),'') is not null
     and v_invoice.stripe_payment_intent_id<>p_payment_intent_id then
    raise exception 'PaymentIntent does not match invoice';
  end if;

  select * into v_payment from public.payments where stripe_payment_intent_id=p_payment_intent_id limit 1;
  if v_payment.id is null then raise exception 'Canonical payment is not available yet'; end if;
  v_owner:=coalesce(v_invoice.ownership_type,'company');
  v_fee:=round(p_fee_cents::numeric/100,2);

  update public.invoices set
    stripe_payment_intent_id=p_payment_intent_id,
    stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
    stripe_processing_fee=v_fee,
    stripe_fee_responsibility=case when v_owner='master' then 'master' else 'company' end
  where id=v_invoice.id;

  select * into v_item from public.company_payout_items where payment_id=v_payment.id limit 1;
  if v_item.id is not null then
    if v_owner='company' then
      v_company_net:=round(greatest(0,coalesce(v_item.gross_entitlement,v_item.transfer_amount,0)-v_fee),2);
      update public.company_payout_items set
        stripe_processing_fee=v_fee,transfer_amount=v_company_net,updated_at=now()
      where id=v_item.id;
    else
      update public.company_payout_items set stripe_processing_fee=0,updated_at=now() where id=v_item.id;
      v_company_net:=v_item.transfer_amount;
    end if;
  else
    v_company_net:=0;
  end if;

  update public.invoices set stripe_transfer_amount=coalesce(v_company_net,stripe_transfer_amount) where id=v_invoice.id;

  update public.master_balance_entries set
    stripe_charge_id=coalesce(nullif(trim(coalesce(p_charge_id,'')),''),stripe_charge_id),
    stripe_processing_fee_cents=case when v_owner='master' then p_fee_cents else 0 end,
    amount_cents=gross_entitlement_cents-case when v_owner='master' then p_fee_cents else 0 end,
    status_reason=case when v_owner='master'
      then 'Master entitlement net of actual Stripe processing fee.'
      else 'Platform fee retained; company absorbs actual Stripe processing fee.' end,
    updated_at=now()
  where stripe_payment_intent_id=p_payment_intent_id;

  select amount_cents into v_master_amount from public.master_balance_entries where stripe_payment_intent_id=p_payment_intent_id;
  return jsonb_build_object(
    'invoiceId',v_invoice.id,
    'ownershipType',v_owner,
    'stripeFeeCents',p_fee_cents,
    'companyNetCents',round(coalesce(v_company_net,0)*100)::bigint,
    'masterNetCents',coalesce(v_master_amount,0)
  );
end;
$$;

revoke all on function public.apply_stripe_processing_fee(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_stripe_processing_fee(uuid,text,text,bigint) to service_role;

create or replace function public.master_balance_summary()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  select jsonb_build_object(
    'availableCents',coalesce(sum(amount_cents) filter(where state='available'),0),
    'disputedCents',coalesce(sum(amount_cents) filter(where state='disputed'),0),
    'refundedCents',coalesce(sum(amount_cents) filter(where state='refunded'),0),
    'reversedCents',coalesce(sum(amount_cents) filter(where state='reversed'),0),
    'serviceRevenueCents',coalesce(sum(service_revenue_cents) filter(where state='available'),0),
    'taxCents',coalesce(sum(tax_cents) filter(where state='available'),0),
    'stripeProcessingFeeCents',coalesce(sum(stripe_processing_fee_cents) filter(where state='available'),0),
    'recordedCents',coalesce(sum(amount_cents),0),
    'entryCount',count(*)
  ) from public.master_balance_entries;
$$;
revoke all on function public.master_balance_summary() from public,anon,authenticated;
grant execute on function public.master_balance_summary() to service_role;

-- Existing unpaid invoices retain their current numbers. We do not rewrite historical paid
-- money. New materialized invoices follow the pre-tax service-price contract.

commit;
