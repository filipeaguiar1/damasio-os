# Damasio OS V51.0.3 — Master Combined

This release combines the planned V51.0.1, V51.0.2 and V51.0.3 foundations:

- Visible Master Access button during development.
- Real Supabase login redirects users with `role = master` to `/master`.
- Demo Master session for immediate review without Supabase credentials.
- Companies dashboard and company creation.
- Canonical `company_id` transition while preserving legacy `organization_id` compatibility.
- Lead Center with company assignment.
- Temporary access requests with three levels: read only, operational support and full temporary.
- Delivery channel: System, Email or Both.
- 30-minute authorization-code expiry.
- Audit log screen and demo audit records.

## Temporary development access

Open `/login` and click **Master Access**.

Before production, remove the visible Master button and require real Supabase authentication only.

## Real Master user

Run the V51 migration and set the authenticated profile role to `master`:

```sql
update public.profiles
set role = 'master', company_id = null, organization_id = null
where email = 'YOUR_EMAIL';
```
