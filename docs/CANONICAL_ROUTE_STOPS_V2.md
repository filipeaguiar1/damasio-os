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
- `visits.route_order` remains a compatibility projection and is written only
  inside the same transaction as `route_stops`.

`route_order_state` provides optimistic concurrency. A phone applying a preview
must send the version it reviewed. If another device changed the route first,
the write is rejected and the user must refresh.

`route_order_audit` records the previous order, next order, source, actor and
resulting version for every route-order mutation.

## Single write path

`replace_canonical_route_order_v2` is the only low-level writer. It:

1. locks the Route and version row;
2. reads every non-cancelled Visit currently belonging to the Route;
3. verifies the requested sequence contains exactly the same Visit IDs once;
4. replaces `route_stops`;
5. updates the `visits.route_order` compatibility projection;
6. increments the Route version;
7. writes an audit record;
8. re-reads both representations and compares them before returning.

Any exception rolls the complete database transaction back.

Public operations are wrappers around this writer:

- `apply_canonical_route_order_v2` — Employee Smart Route and future manual order changes;
- `publish_canonical_route_daily` — Admin daily publication;
- `move_canonical_visits` — temporary and permanent Visit movement;
- `restore_canonical_route_order_v2` — restoration of the original reviewed order.

The previous RPC contracts remain available as thin compatibility wrappers, but
no endpoint may update `visits.route_order` or upsert Smart Route state directly.

## Rollout order

1. Back up the production database.
2. Run `202608020500_canonical_route_stops_v2.sql`.
3. Run `202608020510_canonical_route_writer_wrappers_v2.sql`.
4. Confirm the PostgREST schema reload completed.
5. Run the verification queries below.
6. Deploy the application code.
7. Test Admin publish, Employee Apply, refresh, logout/login and Admin/Employee comparison.

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

```sql
select
  r.id as route_id,
  array_agg(s.visit_id order by s.position)
    filter (where s.visit_id is not null) as route_stops_order,
  array_agg(v.id order by v.route_order)
    filter (where v.id is not null and v.status::text <> 'cancelled') as visits_order
from public.routes r
left join public.route_stops s on s.route_id = r.id
left join public.visits v on v.route_id = r.id
where r.id = '<ROUTE_ID>'::uuid
group by r.id;
```

For operational verification, compare the two arrays in separate subqueries to
avoid the Cartesian product introduced by joining two one-to-many relations.

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

## Rollback

The migration does not delete Routes, Visits, Jobs, Customers or Properties.
`route_stops` is initially backfilled from the existing Visit order. If the
application rollout must be paused, the existing screens can continue reading
`visits.route_order`, because it is maintained as the verified projection.

Do not restore direct endpoint writes or the old implicit trigger. Correct the
transaction and retry instead.
