# Operational simulator API

Authenticated company Admin endpoint used only by the isolated simulator screen.

- `GET`: canonical simulation status and calculated preview.
- `POST { action: "create" }`: creates the linked two-month scenario.
- `POST { action: "remove" }`: deletes only marker-scoped simulation data and temporary accounts.

The endpoint never calls Stripe and never writes outside the authenticated company.
