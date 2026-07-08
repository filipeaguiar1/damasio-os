# Damasio OS V42.7.2 — Visible Dispatch Fix

## Why this version exists
The previous stabilization did not make the operational changes visible enough in the real UI. This version fixes the actual navigation and dispatch flow.

## Changes
- Added **Dispatch** to the Admin sidebar.
- Dashboard primary action now opens **Create Route**.
- `/admin/schedule` is now the clear dispatch screen for selecting many houses, choosing date, choosing crew, and creating the route.
- `/admin/routes` now points empty routes back to Dispatch instead of telling Admin to use Customers.
- Employee Route now respects the `crew` query parameter.
- Employee Route now has a crew selector for testing routes.
- Tasks assigned to Crew B/C/D now appear when Employee Route is opened for that crew.
- Assigning or creating a return task with a date + crew also schedules that property onto the employee route.

## Test flow
1. Open Admin Dashboard.
2. Click **Create Route**.
3. Load Demo if needed.
4. Select houses.
5. Choose date and crew.
6. Click **Create Route**.
7. Click **Open Employee Route**.
8. Confirm the selected crew/day shows the houses.
9. Open Tasks, create a return visit with date + crew.
10. Confirm it appears in Employee Route for that crew/day.
