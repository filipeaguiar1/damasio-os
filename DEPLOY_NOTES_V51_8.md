# Deploy Notes V51.8

## Local Commits Ready

- `cbd3dd2` - Complete lead customer invoice linking
- `94d75a7` - Add company Stripe Connect onboarding

These commits are local and have not been pushed after the safety block. Push only after explicit approval.

## Supabase SQL Order

Run these in Supabase SQL Editor, in order:

1. `supabase/migrations/202607240001_stripe_connect_weekly_payouts.sql`
2. `supabase/migrations/202607240002_payout_permissions_fix.sql`
3. `supabase/migrations/202607240003_lead_customer_quote_linking.sql`
4. `supabase/migrations/202607240004_payout_batch_item_link.sql`
5. `supabase/migrations/202607240005_payout_feedback_task_triggers.sql`

## Required Vercel Environment Variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CRON_SECRET` recommended
- `STRIPE_PLATFORM_FEE_PERCENT` optional

## Stripe Webhook Endpoint

Configure Stripe webhook URL:

`https://damasio-os-h1mc.vercel.app/api/stripe/webhook`

Minimum events:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`

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
11. Master generates weekly batch.
12. Friday cron transfers approved batch to the company Connect account.
