# Operational Simulator V1

## Isolation

- Branch: `feature/25-30-homes-simulator-v1`
- Base: `main`
- PR #39 and `agent/overnight-e2e-qa` are not used or modified.
- Simulation records are restricted to the authenticated company and marked with `[OPERATIONAL_SIMULATION_V1]`.
- No Stripe API is called and no real card is charged.
- Simulated settlement is represented canonically by paid Invoices; the protected `payments` ledger remains reserved for real provider-confirmed events.

## Canonical base scenario

The default scenario creates:

- 60 company-created Customers
- 60 Properties
- 60 approved Quotes
- 60 weekly Jobs
- 2 temporary Employees, each owning 30 homes per week
- 64 historical published Routes across eight weeks
- 480 completed Visits with valid Start/Finish timestamps and durations
- 480 private Employee after-service Photo records
- 120 paid Invoices representing two monthly settlements per Customer
- 2 live Routes for today with 4 scheduled Visits per Employee
- 1 temporary Customer portal login

## Phase 2 — exception week

Admin can run a separate exception week after the base simulation exists. It does not create a parallel data model.

The exception week uses the same canonical records and performs:

- one eight-stop historical Route moved to the next available service day because of rain
- eight linked Visits moved with that Route while preserving Start/Finish chronology
- one separate completed Visit shifted by 20 minutes to represent a late arrival
- Employee completion of one live Visit through Start → In Progress → Finish → Done
- Customer submission of a two-star review with a service problem
- automatic creation of an urgent follow-up Task from the low rating
- Customer submission of a Return Visit request
- Admin status verification for rain, delay, low rating, open Task and Return Visit

Exception markers:

- `[SIM_EXCEPTION_RAIN]`
- `[SIM_EXCEPTION_LATE]`

The operation is idempotent: pressing the exception action again reports the existing canonical exception state instead of shifting the records repeatedly.

## Operating assumptions

- 35% of properties: 20 service minutes
- 45%: 30 service minutes
- 20%: 40 service minutes
- 5 route/travel minutes per Visit
- 25% clipping collection share, adding 8 minutes
- 15 houses per company workday
- 4 workdays per week
- 30 houses per Employee per week
- CAD 40 per weekly service
- CAD 23 hourly wage plus 18% payroll burden
- CAD 600 monthly vehicle payment
- CAD 400 monthly vehicle insurance
- Other business, equipment, fuel, processing and marketing costs are included in the calculator

## Default two-month result

- Revenue before HST: CAD 19,200.00
- HST: CAD 2,496.00
- Total paid Invoice value: CAD 21,696.00
- Operating cost: CAD 13,392.94
- Base operating profit: CAD 5,807.06
- Base operating margin: 30.25%
- Average total Visit time: 35.5 minutes
- Cost per Visit: CAD 27.90
- Profit per Visit: CAD 12.10

## Modeled exception impact

Default exception assumptions across the 480 Visits:

- 5% rain reschedule share: 24 Visits
- 8% late-arrival share: 38 Visits
- 3% service-issue share: 14 Visits
- 50% of issues requiring a return: 7 Return Visits
- 10 Admin minutes per weather reschedule
- 20 delay minutes per late Visit
- 30 service minutes plus travel per Return Visit
- CAD 10 customer credit per service issue

Default modeled impact:

- Exception labour: 20.75 hours
- Customer credits: CAD 140.00
- Total exception cost: CAD 731.15
- Revenue at risk: CAD 560.00
- Adjusted operating profit: CAD 5,075.90
- Adjusted operating margin: 26.44%

## Validation

The dedicated workflow performs:

1. TypeScript and production build.
2. Admin login to the isolated E2E company.
3. Full simulation creation through the Admin UI.
4. Verification of 480 completed Visits and 120 paid Invoices.
5. Admin execution of the canonical exception week.
6. Verification of 8 rain-rescheduled Visits and 1 late arrival.
7. Temporary Employee login.
8. Opening today’s canonical Route.
9. Start → In Progress → Finish → Done on the same Visit.
10. Temporary Customer login.
11. Two-star feedback submission for the completed service.
12. Verification that the low rating creates an open follow-up Task.
13. Return Visit request submission to Admin.
14. Admin verification of low rating, follow-up Task and Return Visit counts.
15. Admin, Employee and Customer screenshots.
