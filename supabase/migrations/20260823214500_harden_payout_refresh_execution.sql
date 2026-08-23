-- Keep payout release recalculation behind server-side/service-role boundaries.
-- The function mutates payout eligibility and must not be directly callable by normal signed-in users.

revoke all on function public.refresh_payout_release_status(uuid) from public, anon, authenticated;
grant execute on function public.refresh_payout_release_status(uuid) to service_role;
