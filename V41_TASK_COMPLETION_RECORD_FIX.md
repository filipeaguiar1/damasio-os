# V41 Task Completion Record Fix

This fix improves the return-task workflow after completion.

## Fixed
- Replaced the Portuguese `Ver o que foi feito` button with English labels.
- Task History now has `View Work Details` and `View Property` actions.
- Admin can review what the Employee completed, including:
  - customer issue
  - completion note
  - completed by
  - started time
  - finished time
  - timer/duration
  - attached completion photos
- Customer History now includes a Return Visit History section so customers can see what was done at their property.
- Completion records snapshot service session information and property photos when a task is resolved.
- CSS adjusted so customer comments and completion notes do not overlap or get covered.
- Admin detail page keeps `Remove from Employee / Return to Admin` for assigned tasks that need reassignment.

## Important UX Rule
Resolved tasks leave Employee screens, remain in Admin Task History, and are visible to the Customer as completed return visits.
