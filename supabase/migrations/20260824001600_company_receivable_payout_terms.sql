-- Normalize company earning amounts from the canonical billing agreement before they enter the receivables ledger.
begin;

create or replace function public.normalize_company_payout_item_terms()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cycle_agreement uuid;
  v_event_agreement uuid;
  v_agreement public.billing_agreements%rowtype;
  v_amount_total numeric;
  v_transfer_cents bigint;
begin
  if new.invoice_id is null then return new; end if;

  select bc.billing_agreement_id, vbe.billing_agreement_id
    into v_cycle_agreement, v_event_agreement
  from public.invoices i
  left join public.billing_cycles bc on bc.id=i.billing_cycle_id
  left join public.visit_billing_events vbe on vbe.id=i.billing_event_id
  where i.id=new.invoice_id;

  if coalesce(v_cycle_agreement,v_event_agreement) is null then return new; end if;
  select * into v_agreement
  from public.billing_agreements
  where id=coalesce(v_cycle_agreement,v_event_agreement);
  if v_agreement.id is null then return new; end if;

  v_amount_total:=coalesce(new.amount_total,0);
  if v_agreement.provider_payout_cents is not null then
    v_transfer_cents:=greatest(0,least(round(v_amount_total*100)::bigint,v_agreement.provider_payout_cents));
  elsif v_agreement.platform_fee_basis_points is not null then
    v_transfer_cents:=greatest(0,round(v_amount_total*100*(10000-v_agreement.platform_fee_basis_points)/10000)::bigint);
  else
    raise exception 'Billing agreement % has no canonical provider payout terms',v_agreement.id;
  end if;

  new.transfer_amount:=round(v_transfer_cents::numeric/100,2);
  new.platform_fee:=round(v_amount_total-new.transfer_amount,2);
  return new;
end $$;

revoke all on function public.normalize_company_payout_item_terms() from public,anon,authenticated;
grant execute on function public.normalize_company_payout_item_terms() to service_role;

drop trigger if exists normalize_company_payout_item_terms_before_write on public.company_payout_items;
create trigger normalize_company_payout_item_terms_before_write
before insert or update of invoice_id,amount_total,transfer_amount,platform_fee on public.company_payout_items
for each row execute function public.normalize_company_payout_item_terms();

-- Reconcile existing non-finalized items to their canonical agreement terms.
update public.company_payout_items p
set amount_total=p.amount_total
where p.status in('pending_feedback','held_task','eligible','approved')
  and p.invoice_id is not null;

commit;
