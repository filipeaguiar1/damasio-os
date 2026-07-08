# Damasio OS V49 — Production Readiness

ERP foundation for landscaping operations, finance, SaaS, AI and mobile field workflows.

New in V49: Production Readiness screen with go-live checklist for operations, dispatch, data, SaaS, finance and mobile.

# Damasio OS V43.0.2 — Feedback History + Stability Fix

- Service Screen refined.
- Removed Overview, Feedback, Tasks and Photos tabs from the property screen.
- Added read-only Feedback History.
- Admin can view feedback history but cannot edit customer ratings.
- Customer Portal now keeps feedback separate from Return Visit request.
- Customer can choose Submit Review, Request Return Visit, or Everything OK.
- Timer controls remain inside Service tab only.
- Reset still affects only the selected house.

# Damasio OS V42.9 — Service Screen Core

This version centralizes property execution in the Service Screen and removes redundant Return Visit start actions.

See `V42_9_SERVICE_SCREEN_CORE.md`.

# Damasio OS V42.0.1 - Database Foundation

This package continues the official V42 Supabase Foundation.

## Local setup

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Then open `/admin/database` and click **Test Database Connection**.

## Supabase setup

The Supabase project is already created. Do not create tables manually in the dashboard. Use:

```text
supabase/00_run_this_first_database_setup.sql
```

A migration copy is also available at:

```text
supabase/migrations/202607020001_v42_database_foundation.sql
```

## Architecture rule

UI → Hook → Service → Repository → Supabase

No screen should talk directly to Supabase.

---

# Damasio OS V42.0 — Supabase Foundation

This version starts the real database phase while keeping the current app experience stable.

## What this sprint does

- Keeps the current demo login and portals.
- Keeps company signup/onboarding paused.
- Prepares Supabase/PostgreSQL/Storage foundation.
- Adds a visible Admin → Database health check.
- Removes the old package lock that pointed to an internal OpenAI registry.
- Adds `.npmrc` so installs use the public npm registry.
- Adds product and architecture documentation.

## Install

```bash
npm install
npm run dev
```

If your computer previously tried to download from an internal registry, run:

```powershell
npm config set registry https://registry.npmjs.org/
npm cache clean --force
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run dev
```

## Supabase setup

1. Create a free Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Add your Supabase Project URL and anon public key.
4. Open Supabase SQL Editor.
5. Run:

```text
supabase/00_run_this_first_database_setup.sql
```

6. Restart the app.
7. Go to Admin → Database.
8. Click **Test Database Connection**.

## Documentation

- `PRODUCT.md`
- `ARCHITECTURE.md`
- `QUALITY.md`
- `BACKLOG.md`
- `V42_0_SUPABASE_FOUNDATION.md`

## Next sprint

V42.1 will migrate the first real module to Supabase, likely Customers or Properties, without changing unrelated screens.
