-- Mirror the canonical company payout split back onto invoices for customer documents and audit UI.
begin;

create or replace function public.sync_invoice_payout_terms_from_item()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.invoice_id is null then return new; end if;

  update public.invoices
  set stripe_platform_fee=round(coalesce(new.platform_fee,0),2),
      stripe_transfer_amount=round(coalesce(new.transfer_amount,0),2),
      stripe_transfer_group=coalesce(new.stripe_transfer_group,stripe_transfer_group)
  where id=new.invoice_id;

  return new;
end $$;

revoke all on function public.sync_invoice_payout_terms_from_item() from public,anon,authenticated;
grant execute on function public.sync_invoice_payout_terms_from_item() to service_role;

drop trigger if exists payout_item_syncs_invoice_terms on public.company_payout_items;
create trigger payout_item_syncs_invoice_terms
after insert or update of platform_fee,transfer_amount,stripe_transfer_group
on public.company_payout_items
for each row execute function public.sync_invoice_payout_terms_from_item();

with latest as (
  select distinct on(invoice_id)
    invoice_id,platform_fee,transfer_amount,stripe_transfer_group
  from public.company_payout_items
  where invoice_id is not null
  order by invoice_id,created_at desc,id desc
)
update public.invoices i
set stripe_platform_fee=round(coalesce(latest.platform_fee,0),2),
    stripe_transfer_amount=round(coalesce(latest.transfer_amount,0),2),
    stripe_transfer_group=coalesce(latest.stripe_transfer_group,i.stripe_transfer_group)
from latest
where i.id=latest.invoice_id;

commit;
