# Browser Operator QA — Damasio OS

## Goal

Create a permanent QA layer that exercises Damasio OS like a real company operator in a real browser, while keeping all writes isolated from production customer/company data.

This complements — and never replaces — the canonical route/map, ecosystem, employee mobile, simulator and migration gates.

## Safety contract

1. Run only against an explicitly configured QA deployment and QA Supabase project/namespace.
2. Refuse to start unless `QA_ALLOW_MUTATIONS=1` and `QA_NAMESPACE` starts with `qa_`.
3. Never use live Stripe credentials. Payment tests use mocks/test mode only.
4. Every created company/customer/property/quote/job/visit/task/photo fixture carries the QA namespace when the schema permits it, or belongs to a QA-only company otherwise.
5. Cleanup is mandatory and verified. A failed cleanup makes the run fail.
6. Never modify pre-existing non-QA records.
7. Preserve `route_stops.position -> visits.route_order`, company isolation, Start/Finish semantics, Smart Route ownership and payout protections.

## Browser evidence

Use Playwright Test as the browser runner. Configure traces, screenshots and video so a failed flow can be replayed visually rather than diagnosed only from logs.

Recommended defaults:

- screenshot: `only-on-failure`
- trace: `retain-on-failure`
- video: `retain-on-failure`
- HTML + GitHub reporters
- Chromium desktop Admin/Customer/Master project
- mobile Chromium Employee project
- deterministic timezone and locale

Artifacts must be uploaded by CI for failed runs. A human should be able to inspect the DOM snapshot, network, console and screenshots for every failed action.

## Operator journeys

### Admin / company operator

- Sign in and recover an existing/expired QA session.
- Navigate customer/master areas without duplicate/legacy navigation.
- Create QA customer and property.
- Create a pre-quote lead and quote; verify quote search.
- Convert/create a QA job with weekly and biweekly recurrence fixtures.
- Open Schedule / Routes / View / Advisor.
- Rebuild Smart Week and verify Monday -> Sunday priority.
- Verify geography beats artificial capacity filling (for example 16 Hamilton + 8 Burlington at capacity 18 remains 16/8).
- Publish and reload. Verify old `scheduled` day membership does not survive the new canonical week.
- Move a house manually, remove from day, cancel and reload.
- Verify `route_stops.position === visits.route_order` after each canonical route mutation.
- Inspect Tasks, History and Payouts.

### Employee

- Sign in on a mobile viewport.
- Load Employee Route after cold start and after session recovery.
- Open a stop, Start, upload/attach QA-only photo fixture when supported, Finish and submit Feedback.
- Verify ordering and next-stop behavior.
- Verify completed/in-progress visits are not silently moved by Smart Week.

### Customer

- Sign in to QA customer account when available.
- Inspect property/service history, photos/feedback exposed to customer and navigation.
- Verify company isolation by attempting only safe negative reads against another QA tenant.

### Master

- Sign in with QA Master role when available.
- Verify company navigation and that tenant boundaries remain intact.

## Regression scenarios required before launch

1. **Stale Sunday recurrence** — seed a QA weekly/biweekly off-pattern scheduled Visit associated with a Smart Route; rebuild/publish/cleanup; assert it cannot survive as an accidental Sunday fallback.
2. **Published-week replacement** — seed an old scheduled day assignment, rebuild to another day, publish, reload from API/database and assert the old `job + date` membership is gone.
3. **Calendar duplication** — assert only the canonical calendar trigger/popover is interactive.
4. **Calendar layering** — open the popover over cards/map/content and assert it is visible/clickable above them.
5. **Idle auth recovery** — simulate stale/expired storage state and assert the app refreshes/re-authenticates instead of remaining on `Checking your account`.
6. **Route reload recovery** — interrupt/retry a route/data request and assert the screen recovers without a permanent loading state.
7. **Geographic clustering** — verify separate localities do not get mixed merely to hit daily capacity.
8. **Canonical ordering** — after reorder/move/remove/cancel, assert route stop position and visit route order remain identical.
9. **Cleanup proof** — after the suite, query the QA namespace/company and assert no mutable fixtures remain.

## CI stages

1. `browser-operator-smoke`: auth + navigation + read-only screens.
2. `browser-operator-admin`: customer/property/quote/job + Smart Week + route mutations.
3. `browser-operator-employee`: mobile route + Start/Finish/Feedback/photos.
4. `browser-operator-customer-master`: customer/master navigation and isolation.
5. `browser-operator-cleanup`: mandatory cleanup + zero-residue assertion.

Run the existing canonical gates after browser mutations. Browser QA is considered successful only when both UI assertions and canonical/database assertions agree.

## Environment variables

The implementation should consume CI secrets, never commit credentials:

- `QA_BASE_URL`
- `QA_NAMESPACE`
- `QA_ALLOW_MUTATIONS=1`
- `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD`
- `QA_EMPLOYEE_EMAIL` / `QA_EMPLOYEE_PASSWORD`
- optional QA Customer/Master credentials
- QA Supabase URL/service credentials scoped to the QA environment

The runner must fail closed when the URL/namespace/safety flags do not identify the approved QA environment.

## Implemented PR #88 phase

- `tests/browser-operator/fixtures.ts` creates a fully namespaced QA-only company, Admin, Employee, Customer, Customer/Property, pre-quote request, quote, lead, jobs and canonical route data using only `QA_NAMESPACE` values.
- `tests/browser-operator/admin-mutable-journey.spec.ts` opens Schedule, Routes, View and Advisor; publishes Hamilton and Burlington route days; validates stale Sunday recurrence cleanup, published-week replacement, geographic clustering, move, remove-from-day, cancel/reload and `route_stops.position -> visits.route_order`.
- `tests/browser-operator/employee-mobile-journey.spec.ts` signs in on the mobile Employee viewport, publishes a QA route for today, runs Start/Finish through the authenticated mobile route API, attaches a QA work-photo fixture, submits Customer feedback and verifies the resulting feedback/task/photo rows.
- `tests/browser-operator/customer-master-smoke.spec.ts` verifies Customer portal/mobile reads for the created QA tenant and runs read-only Master smoke when QA Master credentials are configured.
- Cleanup is mandatory after every mutable scenario and the run fails if company-scoped customers, properties, requests, quotes, jobs, routes, visits, photos, employees, crews, profiles or route stops remain.

## Next implementation step

Run the Browser Operator workflow against the shared QA deployment, inspect the visual evidence artifacts, and only then expand UI-click coverage for the full Smart Week planner controls. Do not point the browser operator at production; the fail-closed environment guard and cleanup proof must stay green.
