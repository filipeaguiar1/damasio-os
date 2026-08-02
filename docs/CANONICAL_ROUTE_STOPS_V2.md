# Canonical Route Stops V2

## Goal

A route must have one durable membership and order that is identical for Admin,
Employee, map rendering and every future API. A successful write means the full
route was committed and verified; a failure means nothing changed.

## Source of truth

`route_stops` is the source of truth for the ordered Visit IDs in one Route.

- `route_id + position` is unique.
- A `visit_id` can exist in only one route.
- Every non-cancelled Visit linked to a Route must exist exactly once.
- `missed` / Needs Reschedule Visits remain durable stops.
- `visits.route_order` is a compatibility read model, written only inside the
  same transaction as `route_stops` and re-read before commit.
- Cancelled Visits keep their history but have `route_order = null`, preventing
  collisions with active route positions under the legacy unique constraint.

`route_order_state` provides optimistic concurrency. The Employee app retains
the version loaded with the map and sends that exact version when Apply or
Restore is requested. If Admin or another device changed the route after the
preview was prepared, the write is rejected and nothing changes.

`route_order_audit` records the previous order, next order, source, actor and
resulting version for every route-order mutation.

## Single write path

`replace_canonical_route_order_v2` is the only low-level writer. It:

1. locks the Route and version row;
2. reads every non-cancelled Visit currently belonging to the Route;
3. verifies the requested sequence contains exactly the same Visit IDs once;
4. replaces `route_stops`;
5. clears every old `visits.route_order` position for that Route;
6. rebuilds the compatibility projection from `route_stops`;
7. increments the Route version;
8. writes an audit record;
9. re-reads both representations and compares them before returning.

Any exception rolls the complete database transaction back.

Public operations are wrappers around this writer:

- `apply_canonical_route_order_v2` — Employee Smart Route and future manual order changes;
- `publish_canonical_route_daily` — Admin daily publication;
- `move_canonical_visits` — temporary and permanent Visit movement;
- `restore_canonical_route_order_v2` — restoration of the original reviewed order;
- `reset_company_route_ownership_v2` — protected company route reset.

Post-RPC integrity helpers are read-only. They compare Route, Visit assignment,
`route_stops`, the compatibility projection and route version. They never create,
move or reorder a Visit.

The previous RPC contracts remain available as thin compatibility wrappers, but
no endpoint may update `visits.route_order` or upsert Smart Route state directly.

## Canonical state on every device

`get_employee_smart_route_state` always returns one database-backed state row for
an accessible Route, even when no Smart Route is active. Its order and version
come from `route_stops` and `route_order_state`.

When Admin publication, Visit movement or route reset changes a Route:

- an older Employee Smart Route state is marked inactive;
- its stored version advances to the new canonical version;
- stale browser Smart Route keys are removed when the Employee app reads the
  inactive database state;
- the app cannot fall back to an old local order.

## Mobile communication

Critical mobile writes publish a shared operation status:

- a blocking, accessible “Saving Smart Route” overlay;
- duplicate Apply protection while the transaction is in flight;
- “Route saved” only after the database confirms count, version and exact order;
- “Route not changed” when the transaction rolls back or rejects stale data.

The operation-status component is mounted once in the mobile layout and can be
reused by other critical writes.

## Rollout order

1. Back up the production database.
2. Run `202608020500_canonical_route_stops_v2.sql`.
3. Run `202608020510_canonical_route_writer_wrappers_v2.sql`.
4. Run `202608020515_canonical_route_projection_constraint_v2.sql`.
5. Run `202608020520_canonical_route_reset_v2.sql`.
6. Run `202608020525_canonical_route_state_read_v2.sql`.
7. Confirm the PostgREST schema reload completed.
8. Run the verification queries below.
9. Deploy the application code.
10. Test Admin publish, Employee Apply, refresh, logout/login, Visit movement,
    Admin/Employee comparison and the protected route reset.

Application code intentionally reports that the migration is missing instead of
falling back to a parallel writer.

## Database verification

### No duplicate position or Visit

```sql
select route_id, position, count(*)
from public.route_stops
group by route_id, position
having count(*) > 1;

select visit_id, count(*)
from public.route_stops
group by visit_id
having count(*) > 1;
```

Both queries must return zero rows.

### Route Stops and Visit projection are identical

Use separate subqueries to avoid the Cartesian product produced by joining two
one-to-many relations.

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
where r.id = '<ROUTE_ID>'::uuid;
```

`route_stops_order` and `visits_order` must be identical.

### Canonical Employee state matches the Route version

```sql
select
  state.route_id,
  state.active,
  state.route_version as smart_route_version,
  order_state.version as canonical_version
from public.employee_smart_route_state state
join public.route_order_state order_state on order_state.route_id = state.route_id
where state.route_id = '<ROUTE_ID>'::uuid;
```

An active Smart Route must have equal versions. An Admin or movement update must
leave the Smart Route inactive.

### Cancelled Visits do not occupy an operational position

```sql
select id, route_id, route_order
from public.visits
where status::text = 'cancelled'
  and route_id is not null
  and route_order is not null;
```

This query must return zero rows after a V2 write touches the Route.

### Audit and version advance together

```sql
select
  state.route_id,
  state.version,
  state.last_source,
  state.updated_at,
  audit.previous_order,
  audit.next_order,
  audit.route_version,
  audit.created_at
from public.route_order_state state
left join lateral (
  select previous_order, next_order, route_version, created_at
  from public.route_order_audit
  where route_id = state.route_id
  order by created_at desc
  limit 1
) audit on true
where state.route_id = '<ROUTE_ID>'::uuid;
```

The latest audit `route_version` must equal the state version after a mutation.

## Rollback

The migrations do not delete Routes, Visits, Jobs, Customers or Properties.
`route_stops` is initially backfilled from the existing Visit order. If the
application rollout must be paused, existing screens can continue reading the
verified `visits.route_order` projection.

Do not restore direct endpoint writes or the old implicit trigger. Correct the
transaction and retry instead.
