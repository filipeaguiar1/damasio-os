-- Idempotent, transactional Master manual invoice creation.
begin;

alter table public.invoices
  add column if not exists manual_request_id uuid;

create unique index if not exists invoices_manual_request_id_unique
  on public.invoices(manual_request_id)
  where manual_request_id is not null;

create or replace function public.create_master_manual_invoice(
  p_request_id uuid,
  p_master_id uuid,
  p_company_id uuid,
  p_customer_id uuid,
  p_visit_id uuid,
  p_amount_cents bigint,
  p_description text
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.invoices%rowtype;
  v_visit public.visits%rowtype;
  v_agreement public.billing_agreements%rowtype;
  v_description text:=trim(coalesce(p_description,''));
  v_tax_cents bigint;
  v_subtotal_cents bigint;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  if p_request_id is null or p_master_id is null or p_company_id is null or p_customer_id is null or p_visit_id is null then
    raise exception 'Manual invoice identity is incomplete';
  end if;
  if not exists(select 1 from public.profiles where id=p_master_id and active and role::text='master') then
    raise exception 'Only an active Master can create manual customer invoices';
  end if;
  if coalesce(p_amount_cents,0)<50 or p_amount_cents>1000000 then raise exception 'Manual invoice amount is invalid'; end if;
  if length(v_description)<8 or length(v_description)>500 then raise exception 'Manual invoice description is invalid'; end if;

  select * into v_existing from public.invoices where manual_request_id=p_request_id limit 1;
  if found then
    if v_existing.customer_id is distinct from p_customer_id
      or v_existing.visit_id is distinct from p_visit_id
      or v_existing.organization_id is distinct from p_company_id
      or v_existing.manual_created_by_profile_id is distinct from p_master_id
      or round(coalesce(v_existing.total,0)*100)::bigint is distinct from p_amount_cents
      or trim(coalesce(v_existing.manual_description,'')) is distinct from v_description
    then
      raise exception 'Manual invoice idempotency key was already used for a different request';
    end if;
    return v_existing.id;
  end if;

  select * into v_visit
  from public.visits
  where id=p_visit_id
    and customer_id=p_customer_id
    and coalesce(company_id,organization_id)=p_company_id
    and status::text='completed'
  limit 1;
  if not found then raise exception 'Manual invoices require a completed Visit for the selected Customer and company'; end if;
  if v_visit.job_id is null then raise exception 'Completed Visit has no canonical Job'; end if;

  select * into v_agreement
  from public.billing_agreements ba
  where ba.job_id=v_visit.job_id
    and ba.active
    and ba.payment_status='active'
  order by ba.version desc,ba.created_at desc
  limit 1;
  if not found then raise exception 'Set an active billing agreement for this Job before creating an extra invoice'; end if;
  if v_agreement.tax_rate_basis_points is null or v_agreement.tax_rate_basis_points<0 or v_agreement.tax_rate_basis_points>3000 then
    raise exception 'The billing agreement does not have a verified tax rate';
  end if;
  if v_agreement.provider_payout_cents is null and v_agreement.platform_fee_basis_points is null then
    raise exception 'The billing agreement has no canonical company payout terms';
  end if;

  v_tax_cents:=case when v_agreement.tax_rate_basis_points=0 then 0 else
    round(p_amount_cents::numeric*v_agreement.tax_rate_basis_points/(10000+v_agreement.tax_rate_basis_points))::bigint end;
  v_subtotal_cents:=p_amount_cents-v_tax_cents;
  v_invoice_number:='MINV-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(p_request_id::text,'-',''),1,8));

  insert into public.invoices(
    organization_id,customer_id,property_id,visit_id,invoice_number,status,
    subtotal,tax,total,manual_description,manual_created_by_profile_id,manual_request_id
  ) values(
    p_company_id,p_customer_id,v_visit.property_id,v_visit.id,v_invoice_number,'waiting_payment',
    round(v_subtotal_cents::numeric/100,2),round(v_tax_cents::numeric/100,2),round(p_amount_cents::numeric/100,2),
    v_description,p_master_id,p_request_id
  ) returning id into v_invoice_id;

  insert into public.master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(
    p_master_id,p_company_id,'invoice.manual_created','invoice',v_invoice_id,
    jsonb_build_object(
      'request_id',p_request_id,'customer_id',p_customer_id,'visit_id',p_visit_id,
      'billing_agreement_id',v_agreement.id,'subtotal_cents',v_subtotal_cents,
      'tax_cents',v_tax_cents,'total_cents',p_amount_cents,'tax_label',v_agreement.tax_label,
      'description',v_description
    )
  );

  return v_invoice_id;
end $$;

revoke all on function public.create_master_manual_invoice(uuid,uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.create_master_manual_invoice(uuid,uuid,uuid,uuid,uuid,bigint,text) to service_role;

commit;
