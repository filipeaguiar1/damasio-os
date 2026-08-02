begin;

-- Employee Smart Route state is a compatibility/read model for the canonical
-- route_stops order. Production Apply requests use the server service role and
-- V2 RPC wrappers read/update this table while route_stops remains authoritative.
-- Some existing databases created the table without explicit grants, causing
-- "permission denied for table employee_smart_route_state" during Apply.

do $$
begin
  if to_regclass('public.employee_smart_route_state') is null then
    raise exception 'employee_smart_route_state table is missing. Run the Employee Smart Route state migration before this permissions patch.';
  end if;
end
$$;

alter table public.employee_smart_route_state enable row level security;

grant usage on schema public to authenticated, service_role;
grant select on public.employee_smart_route_state to authenticated;
grant select, insert, update, delete on public.employee_smart_route_state to service_role;

-- Authenticated users may only read state for their company. Direct writes remain
-- blocked; Apply/Restore must go through the server route or canonical RPCs.
drop policy if exists employee_smart_route_state_company_read
  on public.employee_smart_route_state;

create policy employee_smart_route_state_company_read
on public.employee_smart_route_state
for select to authenticated
using (
  company_id = public.current_company_id()
  or public.master_has_company_access(company_id, 'read_only')
);

notify pgrst, 'reload schema';

commit;
