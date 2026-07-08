# Damasio OS V42.6 — Performance + Workflow Upgrade

Base: **V42.5.1 — Layout Regression Fix**

## Permanent rule preserved

No layout or UX redesign was introduced. This version preserves the V42.5.1 visual experience and changes only internal performance behavior plus the employee Start/Finish workflow.

## Performance changes

- Added a lightweight shared query cache in `lib/performance/queryCache.ts`.
- Cached high-traffic Supabase boards:
  - Scheduling / Dispatch board
  - Operations board
  - Customer Portal board
- Added request de-duplication so simultaneous calls for the same board reuse one pending request.
- Added mutation invalidation after writes, so data refreshes only when it needs to.
- Reduced Employee Route auto-refresh from every 2.5 seconds to a visibility-aware 15-second refresh.
- Kept real-time local updates through storage/sync events.

## Employee Workflow changes

- The route now hides completed houses from the active employee route.
- Completed houses still remain in Admin/customer history through the existing status and activity log flow.
- Start remains simple.
- Finish now completes the house and removes it from the active route.
- Added a simple optional comment button (`💬 Comment`).
- Completion comments are stored with the service session and activity log.
- Existing Google Maps behavior was preserved. No paid map API or route engine was added.

## Database performance

Added `supabase/10_performance_indexes.sql` with safe `create index if not exists` statements for:

- Customers
- Properties
- Jobs
- Visits
- Tasks
- Activity logs

Run this SQL in Supabase after the previous migrations.

## QA target

- `npm run typecheck`
- `npm run build`
- Manual route workflow regression:
  1. Load demo route.
  2. Open a house.
  3. Start.
  4. Add optional comment.
  5. Finish.
  6. Confirm house leaves active route.
  7. Confirm completed count increases.
