-- Ensure the trusted backend can operate the internal billing engine tables.
-- This grants no new access to anon/authenticated roles and leaves RLS policies unchanged.
begin;

grant select, insert, update, delete on table public.billing_agreements to service_role;
grant select, insert, update, delete on table public.billing_cycles to service_role;
grant select, insert, update, delete on table public.visit_billing_events to service_role;

commit;
