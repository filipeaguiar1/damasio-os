# Smart Route canonical stability checkpoint

Date: 2026-08-05 (America/Toronto)
Branch: `feature/25-30-homes-simulator-v1`
PR: `#40`

## Verified at this checkpoint

- Smart Route order persisted after closing and reopening the mobile application.
- Admin mobile and Employee mobile displayed the same route order.
- The canonical database writer, route version, origin and ordered Visit IDs
  were protected and re-read before success.
- Legacy route writers were prevented from overwriting an active canonical
  Smart Route.
- The fixed 18-house optimizer ceiling and fixed 60-house Employee capacity
  ceiling were removed.
- The company Admin's `daily_route_capacity` remains the only daily house limit.

## Still requiring explicit regression testing

- Admin web and Employee web display the same canonical snapshot.
- Smart Route optimization with 25, 30, 60 and 100 houses.
- Concurrent routes for multiple Employees.
- Start, timer, Done, photos and reopen flows under concurrent use.

This checkpoint records that Smart Route was apparently functioning correctly
on the tested mobile Admin and Employee flows on this date. It is a regression
reference, not a claim that every scale and concurrency scenario has already
been certified.

## Employee contract routing follow-up

- Route Advisor house choices are filtered by the selected Employee canonical crew.
- Select all applies only to visible, selectable contracts for that Employee.
- Employee web profiles expose the same assigned Jobs in a collapsible contract list.
- Changing Employee clears stale selections so houses cannot leak between workers.
