begin;

grant usage on schema public to service_role;

grant select on table public.customers to service_role;
grant select, update on table public.properties to service_role;
grant select, insert, update on table public.photos to service_role;

commit;
