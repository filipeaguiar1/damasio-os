# Quote Onboarding Flow

## Goal

Turn a public quote request into a customer account, an approved invoice and a Stripe payment flow without creating active jobs before payment is confirmed.

## Recommended Flow

1. Public visitor requests a quote.
   - Collect name, email, phone, address and service details before showing any average price.
   - Show the average estimate only after contact/property data is complete.
   - Save the request for Admin review.

2. Master Admin reviews the quote.
   - New customer approval belongs to Master, not the company Admin.
   - Master can change the final total and add a revision note.
   - The system stores the final total as the source of truth.
   - The quote should be marked as `sent`, not `approved`, because the current database workflow can create jobs when a quote becomes `approved`.

3. System prepares the customer account.
   - Create or link a Supabase Auth invitation for the customer email.
   - Create/update the `profiles` row with role `customer`.
   - Link `customers.profile_id` to the invited user.
   - Save a `quote_invitations` row for audit and support.

4. System prepares billing.
   - Create or update an invoice in `waiting_payment`.
   - Do not create a job yet.
   - Do not schedule routes yet.

5. Customer signs in from the invite link.
   - Customer portal shows approved quote and pending invoice.
   - Customer confirms payment through Stripe Checkout.
   - Card details stay in Stripe, never in our database.

6. Stripe confirms payment by webhook.
   - Webhook marks invoice/payment as paid.
   - Only then create or activate the job.
   - Paid jobs become available for scheduling, routes, employee map and statistics.
   - A payout item is created for the company, but money is not transferred immediately.

7. Service quality gate controls company payout.
   - Customer pays inside our platform and does not create a Stripe account.
   - The company creates a Stripe Connect account once so it can receive bank payouts.
   - After a completed visit, the payout item stays pending until one of these happens:
     - Customer leaves positive feedback.
     - Three days pass after completion without an open task.
   - If the customer or Master Admin creates a task/issue, the item stays held until the task is resolved.
   - Master Admin can manually cancel, keep pending, approve or release an eligible payout item.
   - Company Admin cannot approve new customer onboarding or override payout holds.

8. Weekly company payout.
   - The work week runs Monday through Sunday.
   - Eligible items from that Monday-Sunday work week are grouped into a payout batch.
   - The scheduled payout day is the following Friday.
   - Example: work completed from Monday July 13 through Sunday July 19 is paid on Friday July 24, as long as the release rules pass.
   - Stripe transfers are created from the platform balance to the company connected account.
   - The platform fee is kept by transfer math, not by `application_fee_amount`, because this flow holds funds before release.

## Stripe Strategy

Use Stripe Checkout for initial invoice or subscription checkout, Stripe Customer Portal for future payment method/subscription management, and Stripe Connect for company payouts.

Why:
- Checkout handles secure card collection, SCA, and hosted payment UI.
- Customer Portal lets customers update cards, invoices and subscriptions without custom sensitive billing screens.
- Webhooks become the official payment source of truth.
- Separate charges and transfers let the platform hold money until feedback/task rules allow weekly company payout.

## Connect Strategy

Recommended charge pattern: separate charges and transfers.

Why this pattern:
- The customer pays the platform only.
- The company receives money to its bank account through Stripe Connect.
- Funds can stay pending while a complaint/task is open.
- Weekly transfers can be approved by Master Admin after the previous week's work is checked.

Avoid destination charges for this workflow, because destination charges transfer to the company at payment time and do not fit the 3-day/task hold rule.

## Status Rules

- `quote.status = draft`: internal quote not ready for customer.
- `quote.status = sent`: Admin reviewed and sent to customer.
- `invoice.status = waiting_payment`: customer must pay/authorize.
- `payment.status = paid`: Stripe webhook confirmed funds.
- `job.active = true`: only after payment is confirmed or Admin explicitly overrides.
- `company_payout_items.status = pending_feedback`: paid, waiting for feedback or 3-day no-task window.
- `company_payout_items.status = held_task`: task/issue blocks the payout.
- `company_payout_items.status = eligible`: ready for Master review in the weekly batch.
- `company_payout_items.status = approved`: Master approved transfer.
- `company_payout_items.status = transferred`: Stripe transfer created.

## Current Local Implementation

- `components/admin/AdminShell.tsx`
  - Removed desktop search to reveal navigation tabs.
  - Quick Actions uses `Routes` instead of `Schedule Service`.

- `app/api/master/quotes/[id]/approve/route.ts`
  - Master-only endpoint to review quote, revise final amount, prepare invoice and send Supabase customer invite.
  - Keeps quote as `sent` so jobs are not created prematurely.

- `app/api/stripe/checkout/route.ts`
  - Creates a Stripe Checkout Session for the invoice.
  - Uses a `transfer_group` so the later Connect transfer can be reconciled.
  - Does not transfer funds immediately.

- `app/api/stripe/webhook/route.ts`
  - Verifies Stripe signatures.
  - Marks paid invoices from `payment_intent.succeeded`.
  - Creates idempotent payment and payout ledger records.

- `supabase/migrations/202607240001_stripe_connect_weekly_payouts.sql`
  - Adds Connect account fields.
  - Adds Stripe payment identifiers.
  - Adds company payout items/batches.
  - Adds payout release status tracking and a release-status refresh function.

## Next Implementation Steps

1. Add Master UI button/form: `Approve + Invite Customer`.
2. Add customer portal onboarding page to claim/display invited quote.
3. Update customer payments page to start Stripe Checkout for the pending invoice.
4. Add Master payout queue UI for weekly approval, hold, cancel and release.
5. Add company Connect onboarding from Master/company settings.
6. Add transfer processor endpoint/cron for approved weekly payout batches.
7. Redesign customer and employee browser/mobile-web layouts so they work cleanly without requiring an app install.
