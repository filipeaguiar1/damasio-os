begin;

-- Final database audit hardening.
-- Keep application DML grants intact while removing structural privileges that
-- browser roles never need. TRUNCATE bypasses RLS, and REFERENCES/TRIGGER are
-- schema-management privileges rather than application-runtime privileges.
revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Prevent future migrations owned by postgres from recreating those grants.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- Production inherited two legacy UNIQUE constraints on route_stops that are
-- byte-for-byte equivalent to the canonical constraints created by Route Stops
-- V2. Keep the names defined by the canonical migration and remove only the
-- duplicate legacy constraints when both sides exist.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_stops'::regclass
      and conname = 'route_stops_route_id_position_key'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_stops'::regclass
      and conname = 'route_stops_route_position_key'
  ) then
    alter table public.route_stops
      drop constraint route_stops_route_position_key;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_stops'::regclass
      and conname = 'route_stops_route_id_visit_id_key'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.route_stops'::regclass
      and conname = 'route_stops_route_visit_key'
  ) then
    alter table public.route_stops
      drop constraint route_stops_route_visit_key;
  end if;
end $$;

-- Finish the RLS initPlan cleanup without changing authorization semantics.
-- Supabase/Postgres can evaluate auth.uid() once per statement when wrapped in
-- SELECT instead of re-evaluating it for every candidate row.
alter policy activity_employee_read_own on public.activity_log
  to authenticated
  using (
    actor_profile_id = (select auth.uid())
    and public.is_employee()
  );

alter policy task_events_company_read on public.task_events
  using (
    company_id = public.current_company_id()
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.active
          and (
            p.role::text = 'admin'
            or (
              p.role::text = 'manager'
              and public.company_module_permission_allowed('tasks', 'view')
            )
          )
      )
      or exists (
        select 1
        from public.tasks t
        join public.customers c on c.id = t.customer_id
        where t.id = task_events.task_id
          and c.profile_id = (select auth.uid())
          and c.archived_at is null
      )
      or exists (
        select 1
        from public.tasks t
        join public.employees e
          on e.profile_id = (select auth.uid())
         and e.active
        where t.id = task_events.task_id
          and (
            t.assigned_employee_id = e.id
            or t.assigned_crew_id = e.crew_id
          )
      )
    )
  );

alter policy customer_manage_payment_preferences on public.customer_payment_preferences
  to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

alter policy customer_wallet_read_own on public.customer_wallets
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_wallets.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy customer_wallet_transactions_read_own on public.customer_wallet_transactions
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_wallet_transactions.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy customer_tips_read_own on public.customer_tips
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_tips.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy billing_agreements_customer_read on public.billing_agreements
  using (
    exists (
      select 1
      from public.customers c
      where c.id = billing_agreements.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy visit_billing_events_customer_read on public.visit_billing_events
  using (
    exists (
      select 1
      from public.customers c
      where c.id = visit_billing_events.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy billing_cycles_customer_read on public.billing_cycles
  using (
    exists (
      select 1
      from public.customers c
      where c.id = billing_cycles.customer_id
        and c.profile_id = (select auth.uid())
        and c.archived_at is null
    )
  );

alter policy visit_reopen_events_company_admin_read on public.visit_reopen_events
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.active = true
        and coalesce(p.company_id, p.organization_id) = visit_reopen_events.company_id
        and (
          p.role::text = 'admin'
          or (
            p.role::text = 'manager'
            and (
              public.company_module_permission_allowed('routes', 'view')
              or public.company_module_permission_allowed('dispatch', 'view')
            )
          )
        )
    )
  );

commit;
