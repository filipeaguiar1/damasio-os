# Damasio OS V41.1 — Auth + Visible Foundation

This version makes the database direction visible and easier to test.

## Added

- `/login` page.
- `/signup` company onboarding page.
- Demo login buttons for Admin, Employee and Customer.
- Supabase Auth sign in when `.env.local` is configured.
- Admin → Users page.
- User role foundation: Admin, Employee and Customer.
- New optional SQL file: `supabase/04_auth_onboarding.sql`.
- Header links for Login and Create Company.

## Important

The system still keeps the demo mode available so you can open and test the portals even before Supabase is fully configured.

## Setup order in Supabase SQL Editor

1. `supabase/01_schema.sql`
2. `supabase/02_rls_policies.sql`
3. `supabase/03_seed_demo.sql`
4. `supabase/04_auth_onboarding.sql`

## Current goal

Make one company work simply first, while preparing the database for a future SaaS model.

## Next recommended step

V41.2 should connect real CRUD for:

- Customers
- Employees
- Properties
- Property photo upload

Then the visible screens will stop depending on mock data.
