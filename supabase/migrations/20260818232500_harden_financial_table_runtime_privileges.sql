-- Financial ledgers must not expose schema/DDL-style privileges to runtime roles.
revoke truncate, references, trigger on table public.invoices from anon, authenticated;
revoke truncate, references, trigger on table public.payments from anon, authenticated;
revoke truncate, references, trigger on table public.company_payout_items from anon, authenticated;
revoke truncate, references, trigger on table public.company_payout_batches from anon, authenticated;

-- Prevent generic Admin DML against canonical financial ledgers.
-- Writes remain behind service-role APIs / SECURITY DEFINER RPCs with explicit validation.
drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_read
on public.invoices
for select
to authenticated
using (organization_id = public.app_org_id() and public.is_admin());

drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_read
on public.payments
for select
to authenticated
using (organization_id = public.app_org_id() and public.is_admin());

-- Narrow payout read policies to signed-in users only.
drop policy if exists "company payout items readable by company and master" on public.company_payout_items;
create policy company_payout_items_read
on public.company_payout_items
for select
to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

drop policy if exists "company payout batches readable by company and master" on public.company_payout_batches;
create policy company_payout_batches_read
on public.company_payout_batches
for select
to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);
