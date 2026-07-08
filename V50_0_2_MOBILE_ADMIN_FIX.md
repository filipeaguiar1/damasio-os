# Damasio OS V50.0.2 — Mobile Admin Fix

Base: V50.0.1 — Mobile Loading Fix

## Scope
- Keep web layout intact.
- Fix `/mobile/admin` compile warning source by moving `themeColor` from `metadata` to `viewport`.
- Fix mobile employee timer build error.
- Preserve the mobile flow: Login → Minha Rota → Service Screen → Start → Fotos/Comentários → Finish → Próxima Casa.

## Changes
1. `app/layout.tsx`
   - Added Next.js `Viewport` export.
   - Moved `themeColor` into `viewport` as required by Next.js 14.
   - Added mobile viewport settings.

2. `app/mobile/employee/page.tsx`
   - Replaced `formatClock(seconds)` with `formatDuration(seconds)`.
   - Timer now displays elapsed service duration correctly as `HH:MM:SS`.

## QA
- `npm run typecheck` passed.
- `npm run build` passed.
- `/mobile/admin` is included successfully in the production build.
- Web app layout files were not redesigned.

## Next recommended step
V50.0.3 should focus on real Supabase mobile read/write flow for route, service session, photos, comments and finish status.
