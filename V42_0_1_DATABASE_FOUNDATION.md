# Damasio OS V42.0.1 - Database Foundation

This version starts the professional SaaS foundation for Damasio OS.

## What changed

- Added Damasio Supabase environment template.
- Added `.env.local.example` ready for the current Supabase project.
- Added Database Blueprint v1.
- Added a versioned migration copy of the current database foundation.
- Preserved the existing V42 UI and demo-login experience.
- Kept the Admin → Database health-check flow.

## Supabase project

Project URL:

```env
NEXT_PUBLIC_SUPABASE_URL=https://kirgirjmasvzkykxtjde.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_faifeK_3kl2CO7MAyvta4A_JE9d4DRs
NEXT_PUBLIC_DEMO_MODE=false
```

## How to run locally

1. Copy `.env.local.example` to `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `/admin/database`.
5. Run the SQL setup if tables do not exist yet.
6. Click `Test Database Connection`.

## Important rule

Do not manually create tables in Supabase Dashboard. Use SQL setup/migrations so the database stays versioned.

## Sprint boundary

No new user-facing feature was added. This version is foundation only.
