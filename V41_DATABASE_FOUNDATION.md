# Damasio OS V41 — Database Foundation

This version starts the real Supabase database foundation without forcing the whole UI to migrate at once.

## What was added

- Supabase/PostgreSQL schema
- Row Level Security policies
- Real SaaS multi-tenant structure
- Real roles: admin, employee, customer
- Real central Property model
- Real task/return visit workflow tables
- Real visit completion record model
- Real photo storage buckets
- TypeScript Supabase database types
- Supabase client helper
- Task repository functions prepared for migration

## Important architecture decision

The system is now designed around `properties`, not just customers.

Customer -> Property -> Request -> Quote -> Invoice -> Payment -> Job -> Visit -> Route -> Employee -> Completion -> Feedback -> History

## Supabase setup order

1. Create a free Supabase project.
2. Open SQL Editor.
3. Run `supabase/01_schema.sql`.
4. Run `supabase/02_rls_policies.sql`.
5. Run `supabase/03_seed_demo.sql` for demo data.
6. Copy `.env.example` to `.env.local`.
7. Add your Supabase URL and anon key.

## Storage buckets

The SQL creates:

- `property-photos`
- `work-photos`

These prepare the app for:

- official property photo
- before photos
- after photos
- issue photos
- completion photos

## Employee restrictions

Employees still do not receive policies for:

- invoices
- payments
- prices
- financial reports
- tips

This means the database itself blocks those records, not only the UI.

## Next implementation step

The next ZIP should connect the first live screens to Supabase in this order:

1. Login/Auth
2. Profiles and role redirect
3. Admin customers/properties
4. Customer Service Issues
5. Employee assigned tasks
6. Work photo upload
7. Completion report visible to Admin and Customer
