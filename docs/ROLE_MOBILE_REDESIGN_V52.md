# V52 Role Portal Redesign

## Objective

Unify Admin, Customer, Employee and Master visual language without merging their permissions or operational responsibilities. Desktop and mobile use the same canonical repositories and database records; mobile changes presentation and navigation only.

## Design principles

- Strong hierarchy, restrained controls and consistent platform patterns.
- Primary actions stay reachable near the lower half of mobile screens.
- Sidebar on wide screens; five-item bottom navigation on narrow screens.
- Minimum 48px action targets.
- Status is communicated by text and icon, never colour alone.
- One card, button, filter, empty-state and list-row system across roles.

## Canonical data rules

1. UI never creates parallel lists.
2. Mobile and browser call the same service/repository.
3. IDs are authoritative. Names and emails are display/fallback values only.
4. Customer -> Property -> Quote -> Job -> Visit -> Route remains the only operational chain.
5. Employee screens load Visits by authenticated employee_id and crew_id.
6. Completed service history is a read-only projection of Visits, Photos, Notes and Feedback.
7. Master mobile uses the same Master APIs as browser Master.
8. A field that can be derived is not stored twice unless the database owns synchronization.
9. Mutations require idempotency keys when they can create charges, payouts, visits or transfers.
10. Role visibility is enforced in database/API policy, not only hidden in CSS.

## Navigation

### Customer
Home, Services, Request, Billing, More.
History lives inside Services and opens the canonical completed Visit detail.
Service Issues moves into Request as a request type.

### Employee
Today, Route, Tasks, Alerts, More.
The service screen keeps timer, directions, photos, notes and Done in one flow.

### Admin
Home, Routes, Returns, Alerts, More.

### Master
Overview, Companies, Leads, Finance, More.
More contains access, audit, theme, health and trash.

## Delivery sequence

1. Shared tokens and responsive shell.
2. Customer web/mobile alignment.
3. Employee web/mobile alignment.
4. Dedicated Master mobile portal.
5. Feature parity audit and permission audit.
6. One build and one controlled deployment after the Vercel limit clears.

## Research basis

The implementation follows current official guidance emphasizing hierarchy, consistency, adaptive navigation, limited onscreen controls, comfortable touch targets and bottom-area primary actions on phones. Sources reviewed: Apple Human Interface Guidelines and adaptive navigation guidance from established design systems.
