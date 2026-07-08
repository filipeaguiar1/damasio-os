# QA Report — V42.3 Quotes Workflow

## Automated

- TypeScript: passed.
- Production build: compiled successfully in sandbox, then stalled at final trace collection.

## Manual checklist for user

1. Run `supabase/07_quotes_workflow_rpc.sql` in Supabase SQL Editor.
2. Start app with `npm run dev`.
3. Confirm `/admin/database` is green.
4. Create quote in `/admin/estimates`.
5. Approve quote.
6. Confirm Job + Tasks in `/admin/operations`.
7. Confirm Tasks in `/admin/tasks`.
