# Canonical Route Stops V2 — Rollout Checklist

Do not merge or deploy the application before the database steps below pass.

## 1. Backup

Create and verify a production database backup before running any V2 SQL.

## 2. Run migrations in this exact order

1. `202608020490_canonical_route_preflight_v2.sql`
2. `202608020500_canonical_route_stops_v2.sql`
3. `202608020510_canonical_route_writer_wrappers_v2.sql`
4. `202608020515_canonical_route_projection_constraint_v2.sql`
5. `202608020520_canonical_route_reset_v2.sql`
6. `202608020525_canonical_route_state_read_v2.sql`
7. `202608020530_canonical_route_backfill_verify_v2.sql`

The preflight is read-only. The final migration synchronizes and verifies every
existing Route. Any invariant failure aborts its transaction.

## 3. Verify the Pedro route

```sql
select
  r.id as route_id,
  (
    select array_agg(s.visit_id order by s.position)
    from public.route_stops s
    where s.route_id = r.id
  ) as route_stops_order,
  (
    select array_agg(v.id order by v.route_order)
    from public.visits v
    where v.route_id = r.id
      and v.status::text <> 'cancelled'
  ) as visits_order,
  state.version,
  state.last_source,
  state.updated_at
from public.routes r
left join public.route_order_state state on state.route_id = r.id
where r.id = '7ce39ec5-b1c5-4ef8-bf3b-8fd01138e3d4'::uuid;
```

`route_stops_order` and `visits_order` must be identical and contain all 16
non-cancelled houses. `version` must be present.

## 4. Verify global invariants

```sql
select route_id, position, count(*)
from public.route_stops
group by route_id, position
having count(*) > 1;

select visit_id, count(*)
from public.route_stops
group by visit_id
having count(*) > 1;

select v.id, v.route_id, v.route_order
from public.visits v
where v.route_id is not null
  and v.status::text <> 'cancelled'
  and not exists (
    select 1
    from public.route_stops s
    where s.route_id = v.route_id
      and s.visit_id = v.id
      and s.position = v.route_order
  );
```

All three queries must return zero problem rows.

## 5. Application smoke test

1. Open the Employee route and confirm all houses load.
2. Create a Smart Route preview.
3. Confirm the global “Saving Smart Route” status appears on Apply.
4. Confirm success only after the database transaction returns.
5. Refresh and verify the order remains identical.
6. Log out and in again; verify the order remains identical.
7. Open Admin and verify the same order.
8. Change the Route from Admin and verify an older Employee preview is rejected.
9. Move a Visit and verify source and destination Route Stops remain synchronized.

## 6. Merge gate

Only mark PR #60 ready and merge after:

- Canonical Route Check succeeds on the final head;
- Vercel preview is READY;
- all seven migrations succeed in the real database;
- the database queries above pass;
- the authenticated Admin/Employee smoke test passes.

PR #39 must remain untouched.
