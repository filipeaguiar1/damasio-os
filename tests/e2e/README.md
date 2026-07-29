# Damasio OS E2E safety boundary

This harness must use only the dedicated removable test company and its canonical Admin, Employee and Customer accounts.

- Keep one shared Supabase company identity and canonical UUIDs across desktop, mobile web and PWA-like projects.
- Use Stripe Test Mode only.
- Never write to production companies, customers or payment activity.
- Preserve traces, screenshots and videos for failed scenarios.
- Keep the PR in draft until the complete related operational package passes.
