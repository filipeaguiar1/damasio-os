# Damasio OS V42.4 — Scheduling & Dispatch

## Scope

- Calendar now reads real Supabase visits and routes.
- Routes page now dispatches approved jobs into real crew routes.
- Admin can schedule jobs, move visits between crews and mark visits completed.
- Activity History records scheduling and status changes.
- New RPC setup file: `supabase/08_scheduling_dispatch_rpc.sql`.

## Architecture

UI → Service → Repository → Supabase RPC

Files added:

- `lib/repositories/schedulingRepository.ts`
- `lib/services/schedulingService.ts`
- `supabase/08_scheduling_dispatch_rpc.sql`

Files updated:

- `app/admin/calendar/page.tsx`
- `app/admin/routes/page.tsx`

## Test Flow

1. Run `supabase/08_scheduling_dispatch_rpc.sql` in Supabase SQL Editor.
2. Open `/admin/calendar`.
3. Open `/admin/routes`.
4. Approve a quote if no unscheduled jobs exist.
5. Add an unscheduled job to a route.
6. Confirm it appears in Calendar.
7. Mark visit completed.
8. Confirm Activity History records the action.
