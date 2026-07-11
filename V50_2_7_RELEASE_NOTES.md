# Damasio OS V50.2.7 — Mobile Service Stabilization

## Completed
- Employee Mobile keeps only Route and Issues as top-level tabs.
- Selecting a house opens the full mobile service details screen.
- Mobile route now shows only properties actually assigned to Crew A; unassigned customers no longer leak into the employee route.
- Service details include property photo, address, customer, click-to-call phone, email, workflow, service/property details, access notes, alerts, admin notes, timer, Start, Finish, photos, comments and directions.
- Photo upload shows the current 5-photo limit and disables at capacity.
- Workflow Queue mobile remains card-based and now stacks metadata/actions safely on narrow phones.
- Schedule reset confirmation explicitly clears route, crew and day through the existing integrated unassign operation, then returns the job to Available.
- Admin mobile sidebar contrast is forced to remain readable instead of rendering white/low-contrast navigation.
- Desktop layout rules were not changed.

## Validation note
The source was reviewed and patched in this package. A full `pnpm build` could not be executed in the isolated build environment because pnpm/dependencies were not available offline and outbound registry access was unavailable. Run `pnpm install --frozen-lockfile` and `pnpm build` locally before deployment.
