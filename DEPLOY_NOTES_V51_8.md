# Deploy Notes V51.8

## Branch Status

The Stripe safety work is published in draft PR #6 on branch `fix/stripe-production-safety`.
Keep the pull request in draft and do not merge or promote it to Production without explicit approval.

## Supabase SQL Order

Run these in Supabase SQL Editor, in order:

1. `supabase/migrations/202607240001_stripe_connect_weekly_payouts.sql`
2. `supabase/migrations/202607240002_payout_permissions_fix.sql`
3. `supabase/migrations/202607240003_lead_customer_quote_linking.sql`
4. `supabase/migrations/202607240004_payout_batch_item_link.sql`
5. `supabase/migrations/202607240005_payout_feedback_task_triggers.sql`
6. `supabase/migrations/202607240006_stripe_production_safety.sql`
7. `supabase/migrations/202607260007_employee_profile_auto_link.sql`
8. `supabase/migrations/202607260008_employee_email_sync.sql`

## Required Vercel Environment Variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (Your account destination)
- `STRIPE_CONNECT_WEBHOOK_SECRET` (Connected accounts destination)
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CRON_SECRET` (required for Vercel Cron authorization)
- `STRIPE_PLATFORM_FEE_PERCENT` optional

After adding or changing any of these values, redeploy the Preview branch before QA.

## Stripe Webhook Endpoint

Configure Stripe webhook URL:

`https://damasio-os-h1mc.vercel.app/api/stripe/webhook`

Create two Sandbox webhook destinations pointing to the same URL.

Your account destination (`STRIPE_WEBHOOK_SECRET`):

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `checkout.session.expired`

Connected accounts destination (`STRIPE_CONNECT_WEBHOOK_SECRET`):

- `account.updated`

## Flow Now Covered Locally

1. Customer submits website quote.
2. Master opens Lead Center.
3. Master clicks `Open / edit`.
4. Master chooses company, final amount and response message.
5. System creates/links customer, property, service request, quote and invoice.
6. Customer invite is sent by Supabase Auth when possible.
7. Customer sees pending invoice in Payments after account completion.
8. Stripe Checkout collects payment.
9. Stripe webhook creates payout item.
10. Feedback/task rules hold or release payout item.
11. Master prepares the weekly draft and reviews its amount.
12. Master explicitly approves the reviewed batch.
13. Friday cron transfers the approved batch to the company Connect account.

## Employee Identity Release

Employee email synchronization now keeps `auth.users`, `public.profiles`, and `public.employees` aligned while preserving `employee_id/profile_id` as the canonical operational identity.
