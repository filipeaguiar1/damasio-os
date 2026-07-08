# Damasio OS V41.2 — Database First Visible Setup

This version keeps the app simple and starts the real database process without adding company signup yet.

## What changed

- Removed the need to create a company during signup.
- Added one single Supabase setup file:
  - `supabase/00_run_this_first_database_setup.sql`
- Improved Admin → Database screen.
- Added visible table checks for:
  - organizations
  - customers
  - employees
  - properties
  - tasks
  - visits
  - photos
  - invoices
  - payments
- Demo login remains available.

## How to start Supabase

1. Create a free Supabase project.
2. Copy Project URL and anon public key.
3. Create `.env.local` from `.env.example`.
4. Run this file inside Supabase SQL Editor:
   - `supabase/00_run_this_first_database_setup.sql`
5. Restart the project.
6. Open Admin → Database.
7. Click **Test Database Connection**.

## Current strategy

We are not building the SaaS onboarding yet.

First goal:

- Database working.
- Properties saved for real.
- Tasks saved for real.
- Photos uploaded for real.
- Login later.

This keeps the project functional and simple while preparing it to grow.
