# Damasio OS V42.3 — Quotes Workflow

## Scope

- Quotes page now uses Supabase data instead of local mock estimates.
- Quote approval creates the operational workflow:
  - Quote status becomes approved.
  - Job is created automatically.
  - First workflow tasks are created automatically.
  - Activity History records the full chain.
- Admin Tasks page now reads Supabase tasks.
- Operations board remains the central operational view.

## Required SQL

Run this file in Supabase SQL Editor before testing V42.3:

```txt
supabase/07_quotes_workflow_rpc.sql
```

## QA Checklist

- Open `/admin/database` and confirm health check passes.
- Open `/admin/estimates`.
- Create a quote.
- Change quote status to Approved.
- Confirm job appears in `/admin/operations`.
- Confirm workflow tasks appear in `/admin/tasks`.
- Resolve a task and confirm it moves to resolved history.
