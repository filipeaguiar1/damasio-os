begin;

-- Damasio OS — the Admin demo sandbox runs only on the trusted server with the
-- Supabase service-role key. That server flow must create the canonical Quote
-- and Job after Customer and Property creation. Do not grant these privileges
-- to anon or authenticated; RLS and normal user permissions remain unchanged.

grant usage on schema public to service_role;

grant select, insert, update, delete
on table public.quotes
to service_role;

grant select, insert, update, delete
on table public.jobs
to service_role;

notify pgrst, 'reload schema';

commit;
