# QA Report V52.9

## Employee Smart Route Database Mode

- Added tenant-scoped `employee_smart_route_state` persistence.
- Added RPCs to apply and restore Employee Smart Route order in a single database transaction.
- Added route access validation for Admin, Manager, Master and assigned Employee/Crew users.
- Added optimistic route version checks so another device cannot silently overwrite an active Smart Route.
- Added activity log events for Smart Route apply/restore actions, including route, crew, date, origin and stop count metadata.
- Added compatibility guards for `activity_log.company_id` and `activity_log.metadata`.
- Added `employee_smart_route_state` to the Admin Database health table list so the V52.9 migration can be confirmed from `/admin/database`.
- Preserved the localStorage fallback for demo routes without a canonical Supabase `routeId`.
- Fixed Employee mobile route ordering so database-backed Smart Routes continue reading the canonical Supabase route order instead of falling back to local demo order.

## Validation

- `pnpm.cmd typecheck` passed.
- `pnpm.cmd build` passed.

## Notes

- PowerShell blocked `pnpm.ps1`, so validation used `pnpm.cmd`.
- Build completed with the existing Node engine warning: project wants Node 24.x, local runtime is Node 26.4.0.
