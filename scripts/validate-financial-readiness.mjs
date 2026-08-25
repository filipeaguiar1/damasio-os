import fs from 'node:fs';

const health = fs.readFileSync('app/api/master/payment-health/route.ts', 'utf8');
const webhook = fs.readFileSync('app/api/stripe/webhook/route.ts', 'utf8');
const connectMigration = fs.readFileSync('supabase/migrations/20260824222500_connect_readiness_and_financial_health.sql', 'utf8');
const autoMigration = fs.readFileSync('supabase/migrations/20260824222800_auto_require_stripe_connect.sql', 'utf8');
const webhookSecretMigration = fs.readFileSync('supabase/migrations/20260824223200_stripe_webhook_secret_rotation.sql', 'utf8');

const required = [
  ['Payment Health ignores pre-launch companies for Connect failures', health.includes('connectRequired.length===0?"healthy"')],
  ['Payment Health checks Master net math', health.includes('invalidMasterMath') && health.includes('gross_entitlement_cents') && health.includes('stripe_processing_fee_cents')],
  ['Payment Health checks company payout net math', health.includes('invalidPayoutMath') && health.includes('gross_entitlement') && health.includes('stripe_processing_fee')],
  ['Connect readiness column defaults false', /stripe_connect_required boolean not null default false/i.test(connectMigration)],
  ['Started Connect automatically becomes required', autoMigration.includes('require_stripe_connect_when_started') && autoMigration.includes('stripe_connect_required := true')],
  ['Webhook rotation secrets are service-role-only', webhookSecretMigration.includes('stripe_webhook_signing_secrets') && webhookSecretMigration.includes('revoke all on table public.stripe_webhook_signing_secrets from anon, authenticated')],
  ['Webhook loads rotated secrets without committing them', webhook.includes('activeWebhookSecrets') && webhook.includes('stripe_webhook_signing_secrets')],
  ['Platform webhook has Stripe Events API authentication fallback', webhook.includes('authenticatePlatformEventViaStripeApi') && webhook.includes('stripe.events.retrieve(candidate.id)')],
  ['Connect events never use unsigned Events API fallback', webhook.includes('if (candidate.account) return null;')],
];

const failed = required.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}
for (const [name] of required) console.log(`PASS ${name}`);
