# V42.0 — Supabase Foundation

This version starts the real database phase without changing the main UI flows.

## What changed

- Added public npm registry configuration through `.npmrc`.
- Removed the old `package-lock.json` that pointed to an internal registry.
- Updated package name/version to V42.0.
- Added product/architecture/quality/backlog docs.
- Added repository/service structure for future module migration.
- Improved Supabase database health check using a database RPC function.
- Kept demo login and current portals unchanged.
- Company signup/onboarding remains paused.

## Setup

1. Run:

```bash
npm install
npm run dev
```

2. Create `.env.local` from `.env.example`.

3. In Supabase SQL Editor, run:

```text
supabase/00_run_this_first_database_setup.sql
```

4. Restart the app.

5. Open Admin → Database and click **Test Database Connection**.

## Important

This sprint does not migrate Customers/Properties/Jobs yet. It prepares the foundation so the next sprint can migrate one module safely.
