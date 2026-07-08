# Damasio OS V50.0.1 — Mobile Loading Fix

Focus: make the mobile app open reliably for first testing.

## Included
- `/mobile` opens the mobile app inside the current project.
- Splash animation has a hard timeout and cannot block the app.
- Added an **Open app** button on the splash as a manual escape.
- Supabase realtime cannot block the mobile UI.
- Storage version updated to clear old timer sessions.
- Employee path remains simple: Route → Service Screen → Start → Finish.

## Access
Run the project and open:

```bash
http://localhost:3000/mobile
```

If using Next dev default port from your setup, use that same port.
