# Damasio OS V51.0 — Multi Company / Master Foundation

## Included
- Hidden `/master` control plane with no link in public, Admin, Employee, or Customer navigation.
- Login redirects only authenticated profiles with `role = master` to `/master`.
- Non-Master access is signed out and redirected to `/login`.
- Private Companies overview.
- Additive `company_id` migration on profiles while preserving `organization_id` compatibility.
- Database foundation for three temporary-access levels:
  - `read_only`
  - `operational_support`
  - `full_temporary`
- Delivery channels: system, email, or both.
- Master audit log foundation.
- Lead Center foundation.
- RLS restricting Master control-plane records to active Master profiles.

## Required Supabase step
Run:
`supabase/migrations/202607120001_v51_multi_company_master_foundation.sql`

Create the initial Master user in Supabase Auth, then update its profile role:

```sql
update public.profiles
set role = 'master', organization_id = null, company_id = null
where email = 'YOUR_MASTER_EMAIL';
```

The Master route is intentionally not shown anywhere in the interface. Access begins through the normal login page.

## Compatibility note
Current V50 operational repositories continue using `organization_id`. V51 introduces `company_id` additively first to avoid breaking the working ERP. Module-by-module migration follows after the Master foundation is validated.
