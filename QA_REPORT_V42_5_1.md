# QA Report — Damasio OS V42.5.1

## Scope
Layout regression fix after V42.5.

## Checks
- Admin Routes layout restored from V42.3.
- Admin Calendar layout restored from V42.3.
- Customer Portal files preserved.
- Supabase SQL files preserved through 09_customer_portal_rpc.sql.
- Repository/service files preserved.

## Build
Run locally with:

```bash
npm install
npm run build
npm run dev
```

## Manual testing
- `/admin/routes`
- `/admin/calendar`
- `/customer`
- `/customer/requests`
- `/customer/feedback`
- `/customer/tasks`
- `/customer/history`
