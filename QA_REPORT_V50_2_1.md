# V50.2.1 Mobile Interaction Fix

Scope: fix mobile cut content and tap/button usability without changing desktop layout.

Changes:
- Added mobile-only overflow protection for Employee, Customer, Admin and Field screens.
- Converted route rows and status cards into stacked mobile-safe cards under 760px.
- Improved tap targets and z-index for mobile buttons and links.
- Preserved desktop layout and ERP data flow.

Validation note: build should be run on Windows/Node 20 with `pnpm build`.
