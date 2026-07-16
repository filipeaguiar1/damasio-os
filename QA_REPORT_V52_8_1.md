# QA Report — V52.8.1 Smart Route hardening

## Changes
- The circular alternative-route button remains visible during recalculation and rotates while a new route is generated.
- The button was moved to the upper-right area of the preview map so the property action sheet cannot cover it.
- Applying a Smart Route now validates every stop against the selected employee/crew and date before changing route order.
- Restoring an original route now keeps houses assigned after the Smart Route was created and prevents duplicate route-order positions.

## Important architecture findings before production database migration
1. Smart Route and route-start state are currently persisted in browser localStorage. This is suitable for demos but must move to tenant-scoped database records before real customers use multiple devices.
2. Database writes should use optimistic concurrency/version checks so Admin and Employee cannot silently overwrite each other’s route order.
3. Every route mutation must be scoped by organization/company, employee, route date and route ID—not only by lead IDs.
4. Route application, origin persistence and activity logging should be one database transaction.
5. Employee permissions must be enforced server-side; mobile UI restrictions alone are insufficient.
6. GPS should remain request-only. No continuous tracking was introduced.
