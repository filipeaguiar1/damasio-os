# QA Report — V42.5 Customer Portal + Feedback

## Result

Passed.

## Checks

- TypeScript: passed with `npx tsc --noEmit`.
- Production build: passed with `npm run build`.
- Routes generated: 54.
- Customer Portal pages compile.
- Supabase RPC file included.
- `.env.local` not included.

## Manual test required by user

Before testing, run in Supabase SQL Editor:

```txt
supabase/09_customer_portal_rpc.sql
```

Then test:

```txt
/customer
/customer/next-visit
/customer/history
/customer/tasks
/customer/requests
/customer/feedback
/admin/operations
/admin/tasks
```
