begin;

-- Canonical ownership is contract_owner_role. Keep legacy ownership_type aligned.
update public.billing_agreements
set ownership_type=contract_owner_role,
    updated_at=now()
where contract_owner_role in ('master','company')
  and ownership_type is distinct from contract_owner_role;

-- Rebuild the affected functions so legacy data can never override canonical ownership.
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
  v_owner text;
begin
  if new.invoice_id is null then return new; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.id is null then return new; end if;

  select bc.billing_agreement_id,vbe.billing_agreement_id,i.visit_id
    into v_cycle_agreement,v_event_agreement,v_invoice_visit
  from public.invoices i
  left join public.billing_cycles bc on bc.id=i.billing_cycle_id
  left join public.visit_billing_events vbe on vbe.id=i.billing_event_id
  where i.id=new.invoice_id;

  if coalesce(v_cycle_agreement,v_event_agreement) is not null then
    select * into v_agreement from public.billing_agreements where id=coalesce(v_cycle_agreement,v_event_agreement);
  else
    if coalesce(new.visit_id,v_invoice_visit) is not null then
      select v.job_id into v_job from public.visits v
      where v.id=coalesce(new.visit_id,v_invoice_visit) and v.customer_id=new.customer_id limit 1;
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

  v_owner:=coalesce(v_agreement.contract_owner_role,v_agreement.ownership_type,'company');
  if v_owner='master' then
    v_company_service:=round(coalesce(v_agreement.provider_payout_cents,0)::numeric/100,2);
    v_company_service:=greatest(0,least(v_company_service,coalesce(v_invoice.subtotal,0)));
    v_master_service:=round(coalesce(v_invoice.subtotal,0)-v_company_service,2);
    v_company_tax:=0;
  else
    v_fee_bps:=coalesce(v_agreement.platform_fee_basis_points,0);
    v_master_service:=round(coalesce(v_invoice.subtotal,0)*v_fee_bps/10000,2);
    v_company_service:=round(coalesce(v_invoice.subtotal,0)-v_master_service,2);
    v_company_tax:=round(coalesce(v_invoice.tax,0),2);
  end if;

  new.ownership_type:=v_owner;
  new.service_amount:=v_company_service;
  new.tax_amount:=v_company_tax;
  new.stripe_processing_fee:=greatest(0,coalesce(new.stripe_processing_fee,0));
  new.gross_entitlement:=round(v_company_service+v_company_tax,2);
  new.transfer_amount:=round(greatest(0,new.gross_entitlement-new.stripe_processing_fee),2);
  new.platform_fee:=v_master_service;
  return new;
end;
$$;

-- The payment reconcilers and Master ledger can be corrected with a deterministic
-- data-level rule: contract_owner_role wins whenever a billing agreement exists.
create or replace function public.canonical_invoice_owner(p_invoice_id uuid)
returns text
language sql
security definer
set search_path=public
stable
as $$
  select coalesce(
    (select ba.contract_owner_role
       from public.invoices i
       left join public.visit_billing_events e on e.id=i.billing_event_id
       left join public.billing_cycles c on c.id=i.billing_cycle_id
       join public.billing_agreements ba on ba.id=coalesce(e.billing_agreement_id,c.billing_agreement_id)
      where i.id=p_invoice_id limit 1),
    (select case when c.acquisition_source='platform' or c.platform_managed=true then 'master' else 'company' end
       from public.invoices i join public.customers c on c.id=i.customer_id
      where i.id=p_invoice_id limit 1),
    'company'
  );
$$;
revoke all on function public.canonical_invoice_owner(uuid) from public,anon,authenticated;
grant execute on function public.canonical_invoice_owner(uuid) to service_role;

commit;
