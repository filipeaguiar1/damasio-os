# Damasio OS V42.0.3 — Live Health Check

## Goal
Make `/admin/database` execute a real Supabase health check instead of staying visually pending until the user understands the button flow.

## Changes
- Added automatic health check on page load when Supabase env vars are configured.
- Kept manual `Run Live Health Check` button.
- Disabled the button while checks are running.
- Updated page copy from V42.0.2 to V42.0.3.
- Preserved the rule: UI → Service → Repository → Supabase.

## Expected behavior
- If `.env.local` is configured, the page immediately tests Supabase.
- If setup SQL has not been run, environment/auth may pass and tables/buckets may fail.
- If setup SQL has been run, all checks should return OK.
