# Damasio OS V42.2 — Operations Database

## Scope

Connect the first operations layer to Supabase:

- Quotes
- Jobs
- Tasks
- Activity History

## New route

- `/admin/operations`

## Architecture

UI → Service → Repository → Supabase RPC

## Supabase setup

Run this SQL file after V42.1 setup:

```txt
supabase/06_operations_rpc.sql
```

## Behavior

- Create Quote saves to Supabase.
- Approving a Quote creates a Job in Supabase.
- Create Task saves to Supabase.
- Resolving a Task updates Supabase and Activity History.
- Activity History records important operations.

## Notes

This is an early controlled operations bridge. Existing pages are preserved to avoid regressions. The new Operations page validates the real database workflow before replacing older local-storage modules.
