import fs from 'node:fs';

const health = fs.readFileSync('app/api/master/payment-health/route.ts', 'utf8');
const connectMigration = fs.readFileSync('supabase/migrations/20260824222500_connect_readiness_and_financial_health.sql', 'utf8');
const autoMigration = fs.readFileSync('supabase/migrations/20260824222800_auto_require_stripe_connect.sql', 'utf8');

const required = [
  ['Payment Health ignores pre-launch companies for Connect failures', health.includes('connectRequired.length===0?"healthy"')],
  ['Payment Health checks Master net math', health.includes('invalidMasterMath') && health.includes('gross_entitlement_cents') && health.includes('stripe_processing_fee_cents')],
  ['Payment Health checks company payout net math', health.includes('invalidPayoutMath') && health.includes('gross_entitlement') && health.includes('stripe_processing_fee')],
  ['Connect readiness column defaults false', /stripe_connect_required boolean not null default false/i.test(connectMigration)],
  ['Started Connect automatically becomes required', autoMigration.includes('require_stripe_connect_when_started') && autoMigration.includes('stripe_connect_required := true')],
];

const failed = required.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}
for (const [name] of required) console.log(`PASS ${name}`);
