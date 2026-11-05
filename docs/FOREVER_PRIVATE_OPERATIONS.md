# 4Ever Seasons — Private Residential Services

## Decision (2026-11-05)

4Ever Seasons becomes one owner-operated private residential services business. Felipe is the sole application operator, with customers being individual households. There is no multi-company SaaS, worker app, or customer app. The public website and email/payment links remain customer-facing.

The former system is archived on branch archive/4ever-seasons-original-2026-11-05 at commit 5708d0188cbe03dbb3253ba3f1c624699165d632. The new work lives on feature/4ever-private-snow-services-2026-11-05. Production has not been changed.

## Commercial model

- One visit: individually priced and paid, one confirmed job.
- Monthly: individually priced coverage with explicit service terms and renewal choice.
- Whole winter season: individually priced prepaid seasonal agreement.
- Customer requests service online. Felipe reviews the address, coverage and price before any payment.
- Felipe gets an owner-only dashboard with individual expandable customers, payment history, invoices, visit history and photos. No customer login or app is needed.

## Implemented in feature branch

- Root site and /private-snow landing page for direct snow removal requests.
- POST /api/public/private-snow-requests for validated lead intake; saves to existing lead_center within the configured company.
- /owner/login and /owner: private, mobile-friendly owner workspace.
- GET /api/owner/overview: bearer session and exact owner-user authentication; tenant-filtered customers, leads, invoices, payments, visits and archived photo metadata.
- GET /api/owner/photos: generates private signed photo links, valid 10 minutes.
- POST /api/owner/photos: private, validated before/after image upload tied to an existing visit in work-photos.

## Required environment configuration (not performed by this code branch)

- FOREVER_OWNER_USER_ID: UUID of Felipe's authorized, active Supabase profile.
- FOREVER_COMPANY_ID: UUID of a verified active 4Ever Seasons organization, not an unrelated Damasio or test tenant.
- Existing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

Routes fail closed if configuration is missing. This branch does not create an organization or mutate production data.

## Remaining before launch

1. Verify 4Ever Seasons storage/data isolation and take a separate backup of the production database; a GitHub archive does not back up Supabase records, Stripe settings or Vercel settings.
2. Turn incoming requests into canonical customers, properties and appointments in the owner workflow, with duplicate prevention.
3. Let Felipe set prices and send a server-priced Stripe payment link; reconcile confirmed charges by verified webhook into individual invoices and payments.
4. Define monthly and seasonal service dates, service triggers, snow-depth clauses, tax/fees, renewals and cancellation terms.
5. Add visit creation, completion, schedule calendar, and photo-based completion from the owner app.
6. After completion, automatically send branded emails containing secure expiring photo gallery links and retry or report failed sends. There is no automatic photo email yet.
7. Implement owner-only installable PWA, no employee or customer application.
8. Add durable rate limiting, monitoring, pagination, photo limits and comprehensive security tests.
9. Run build/typecheck and end-to-end QA, Stripe sandbox tests and email tests before enabling production.

## Safety rules

- No payment from a public browser amount or an unapproved quote.
- No confirmation of payment solely from the success URL; rely on Stripe webhook verification.
- Never expose or permanently publish customer photos.
- No unrelated tenant data and no new separate/fake data model.
- Original code and data must remain recoverable; do not delete old modules or merge/deploy without testing.
- This code snapshot is not a full infrastructure/database backup.

## QA status

Changes are committed only to a feature branch. A complete Next.js build, application security test and live payment or email integration test have not yet been completed.