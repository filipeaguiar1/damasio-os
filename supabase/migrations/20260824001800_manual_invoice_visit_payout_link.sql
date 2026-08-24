-- Preserve the selected completed Visit on Master-created invoices when Stripe materializes payout items.
begin;

create or replace function public.attach_manual_invoice_visit_to_payout_item()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_visit uuid;
  v_job uuid;
begin
  if new.invoice_id is null or new.visit_id is not null then return new; end if;
  select i.visit_id into v_visit from public.invoices i where i.id=new.invoice_id;
  if v_visit is null then return new; end if;
  select v.job_id into v_job from public.visits v where v.id=v_visit and v.customer_id=new.customer_id;
  if not found then raise exception 'Manual invoice Visit does not match payout Customer'; end if;
  new.visit_id:=v_visit;
  new.job_id:=coalesce(new.job_id,v_job);
  new.hold_reason:='Waiting for completed service feedback or 3 days without open tasks.';
  return new;
end $$;

revoke all on function public.attach_manual_invoice_visit_to_payout_item() from public,anon,authenticated;
grant execute on function public.attach_manual_invoice_visit_to_payout_item() to service_role;

drop trigger if exists attach_manual_invoice_visit_before_payout on public.company_payout_items;
create trigger attach_manual_invoice_visit_before_payout
before insert on public.company_payout_items
for each row execute function public.attach_manual_invoice_visit_to_payout_item();

commit;
