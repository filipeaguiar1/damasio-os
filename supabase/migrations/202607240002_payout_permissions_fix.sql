-- Damasio OS V51.8.1 - payout table permission fix.
-- RLS policies decide which rows are visible; grants allow the roles to reach the tables.
begin;

grant select on table public.company_payout_items to authenticated;
grant select on table public.company_payout_batches to authenticated;
grant all privileges on table public.company_payout_items to service_role;
grant all privileges on table public.company_payout_batches to service_role;

grant execute on function public.refresh_payout_release_status(uuid) to service_role;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to authenticated;
grant execute on function public.generate_company_weekly_payout_batch(uuid,date) to service_role;

commit;
