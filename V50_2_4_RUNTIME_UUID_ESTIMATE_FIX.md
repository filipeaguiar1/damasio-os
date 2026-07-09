# V50.2.4 Runtime UUID + Estimate Fix

Scope: runtime stabilization only.

Fixes:
- Replaced direct `crypto.randomUUID()` usage with `createId()` fallback helper.
- Prevents runtime crash in browsers/environments where `crypto.randomUUID` is unavailable.
- Rechecked estimate totals call around `saveEstimate` and preserved `calculateEstimateTotals(input.items)`.
- Kept V50.2.2/V50.2.3 mobile overflow/admin access behavior intact.

No new features. No desktop layout changes.
