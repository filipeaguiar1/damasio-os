# V41 Task Return / Assignment Fix

Implemented after testing the Task Center workflow.

## Fixed
- New customer tasks now stay with Admin by default.
- Demo tasks now stay with Admin by default instead of being sent to Filipe automatically.
- Employee screens only show tasks assigned to that worker or crew.
- Admin must choose a worker/crew and a return date before sending the task.
- Added `Return for Admin` for Employee tasks.
- Returned tasks go back to Admin as open/unassigned so Admin can reassign them.
- Cleaned the Open Tasks layout so it is no longer squeezed into the route grid layout.
- Open Tasks now separates:
  - Waiting for Admin
  - Sent to Employee / Crew

## Validation
- TypeScript check passed with `npm run typecheck`.
