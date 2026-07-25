-- Allow trusted server routes using SUPABASE_SERVICE_ROLE_KEY to manage billing.
-- RLS remains enabled for browser roles; this does not expose invoices to anon/authenticated users.
begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.invoices to service_role;
grant select on table public.quotes to service_role;
grant select on table public.service_requests to service_role;
grant select on table public.customers to service_role;
grant select on table public.profiles to service_role;

commit;
