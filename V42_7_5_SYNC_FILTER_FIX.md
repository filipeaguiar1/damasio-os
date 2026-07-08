# Damasio OS V42.7.5 — Sync + Compact Filters Fix

## What changed

- Customer creation now mirrors the customer/property into the operational list used by Dispatch/Routes.
- Customers, Properties and Dispatch now read from the same unified customer/property source.
- If Supabase is unavailable, the local operational sync still works so testing does not break.
- Added compact hidden filter icon pattern to large operational screens.
- Added filters to Customers, Properties, Dispatch, Routes, Tasks and Employee Route.
- Dispatch keeps route locking: assigned/completed houses cannot be selected for a second active route.

## Important UX behavior

- A newly created customer/property is immediately available in Dispatch.
- Dispatch filter defaults to All, with options for Available, Assigned, Done and This Crew.
- Employee Route filter defaults to All, with Open and Done options.
- Filters stay visually small, hidden behind a small icon.

## QA

- TypeScript passed.
- Production build compiled successfully.
