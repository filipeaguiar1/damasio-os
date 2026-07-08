# Damasio OS — Architecture

## Official architecture

UI → Hook → Service → Repository → Supabase

Pages and components must not call Supabase directly for business modules. Supabase access should be isolated in repositories so we can maintain, test and evolve the app more safely.

## Current sprint

**V42.0 — Supabase Foundation**

This sprint prepares the app to connect to Supabase without changing the user experience.

## Entity priority

Property is the central entity. Customer owns one or more properties. Jobs, visits, tasks, photos, quotes, invoices and payments connect back to property wherever possible.

## Access levels

- Admin: can see and manage all operational and financial data.
- Employee: can see only assigned crew/job/property data. No prices, invoices, payments, tips or financial reports.
- Customer: can see only their own properties, services, history, quotes, invoices and service issues.

## Data strategy

We will migrate one module at a time:

1. Supabase foundation
2. Customers
3. Properties
4. Employees and crews
5. Jobs and visits
6. Tasks and return visits
7. Photos and storage
8. Finance
