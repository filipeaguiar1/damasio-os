# Operational Simulator V1

## Isolation

- Branch: `feature/25-30-homes-simulator-v1`
- Base: `main`
- PR #39 and `agent/overnight-e2e-qa` are not used or modified.
- Simulation records are restricted to the authenticated company and marked with `[OPERATIONAL_SIMULATION_V1]`.
- No Stripe API is called and no real card is charged.
- Simulated settlement is represented canonically by paid Invoices; the protected `payments` ledger remains reserved for real provider-confirmed events.

## Canonical scenario

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
- Customer feedback submitted through the canonical portal
- A Return Visit request submitted by the Customer and delivered to Admin

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
- Operating profit: CAD 5,807.06
- Operating margin: 30.25%
- Average total Visit time: 35.5 minutes
- Cost per Visit: CAD 27.90
- Profit per Visit: CAD 12.10

## Validation

The dedicated workflow performs:

1. TypeScript and production build.
2. Admin login to the isolated E2E company.
3. Full simulation creation through the Admin UI.
4. Verification of 480 completed Visits and 120 paid Invoices.
5. Temporary Employee login.
6. Opening today’s canonical Route.
7. Start → In Progress → Finish → Done on the same Visit.
8. Temporary Customer login.
9. Feedback submission for the completed service.
10. Return Visit request submission to Admin.
11. Admin, Employee and Customer screenshots.
