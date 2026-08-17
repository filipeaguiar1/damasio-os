-- Internal Customer/profile invariant guards are trigger-only functions.
-- They do not need to be callable through the exposed RPC surface.
begin;

revoke execute on function public.guard_customer_profile_link() from public, anon, authenticated;
revoke execute on function public.guard_customer_profile_role_repurpose() from public, anon, authenticated;

commit;
