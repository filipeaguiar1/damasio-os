# V41 Database Visible Status

This update makes the database foundation visible inside the Admin portal.

## New visible items

- Admin sidebar link: Database
- Dashboard card: V41 Database Foundation
- New page: /admin/database
- Supabase connection status
- Test Connection button
- Setup checklist for .env.local and SQL files

## Important

The previous database foundation was mostly backend-only: SQL schema, RLS policies, Supabase client and TypeScript types. That is why the UI looked almost the same.

This package adds a visible setup screen so the Admin can confirm when Supabase is configured.

## Next step

After Supabase is configured, the next version should connect real Auth and redirect users by role:

- Admin -> /admin
- Employee -> /employee
- Customer -> /customer
