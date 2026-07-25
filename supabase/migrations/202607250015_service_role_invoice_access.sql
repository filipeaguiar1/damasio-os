begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.invoices to service_role;
grant select on table public.quotes to service_role;
grant select on table public.service_requests to service_role;
grant select, update on table public.customers to service_role;
grant select on table public.profiles to service_role;

commit;
