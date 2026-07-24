# Stripe Connect Plan

## Decision

Use Stripe Checkout + Connect with separate charges and transfers.

This matches the business rule:
- The customer pays on the Damasio/4Ever Seasons platform.
- The customer does not create a Stripe account.
- Each company onboards once with Stripe Connect to receive bank payouts.
- The platform can hold funds while feedback/tasks are unresolved.
- Master Admin controls exceptions and weekly payout approval.

## Money Flow

1. Customer pays an approved invoice through Stripe Checkout.
2. Stripe creates the charge on the platform account.
3. The webhook marks invoice/payment as paid.
4. The app creates a `company_payout_items` row.
5. The payout item waits for release rules:
   - Positive customer feedback releases it.
   - Or 3 days after completed visit with no open task releases it.
   - Any open task keeps it held.
   - Database triggers refresh this automatically when feedback is saved or a task changes status.
6. The system groups eligible work from Monday through Sunday.
7. Master Admin reviews the eligible weekly batch.
8. Approved batches are scheduled for the following Friday.
9. Approved items are transferred to the company's Stripe connected account.
10. The company receives normal Stripe payouts to its bank account.

Example: work completed Monday through Sunday last week is paid on the next Friday, as long as there is no blocking task and the feedback/3-day rule has passed.

The production cron `/api/cron/weekly-payouts` runs on Fridays and creates Stripe Transfers only for batches that are already `approved` and scheduled for that date or earlier.

## Master-Only Controls

Master Admin can:
- Create/approve new customer onboarding.
- Adjust final quote amount before sending.
- Hold a payout item.
- Cancel a payout item when justified.
- Approve weekly payout batches.
- Retry failed payout batches.

Company Admin can:
- Recommend services.
- Manage work orders/routes/customers.
- View payout status.
- Complete the operational work that makes payout eligible.

Company Admin cannot:
- Approve new customer onboarding.
- Override payout holds.
- Cancel payout items.
- Release money manually.

## Required Environment Variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `STRIPE_PLATFORM_FEE_PERCENT` optional, default `0`

## Webhooks

Minimum:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`

Next:
- `account.updated`
- `transfer.created`
- `transfer.reversed`
- `charge.dispute.closed`

## Next Build Steps

1. Apply the payout and lead-linking migrations in Supabase.
2. Add Connect onboarding endpoints and UI for companies.
3. Add manual Master payout hold/cancel/retry buttons.
4. QA desktop, mobile browser and mobile app payment states.
