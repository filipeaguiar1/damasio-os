import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(path, "utf8");
}

function requireFragments(path, fragments) {
  const text = source(path);
  for (const fragment of fragments) {
    if (!text.includes(fragment)) {
      throw new Error(`${path} is missing required monthly billing contract: ${fragment}`);
    }
  }
}

requireFragments("supabase/migrations/20260823211500_monthly_billing_payment_hardening.sql", [
  "Recurring services are billed monthly, not after each Visit",
  "collection_timing='period_prepaid'",
  "billing_model='monthly_fixed_subscription'",
  "on conflict (billing_agreement_id,period_starts_on,period_ends_on) do nothing",
  "billing_cycle_id",
]);

requireFragments("components/payments/ContractPaymentsWorkspace.tsx", [
  'recurring ? "period_prepaid" : collectionTiming',
  '"monthly_fixed_subscription"',
  "Monthly · one invoice per month",
  "Visits do not create separate customer charges",
]);

requireFragments("app/api/master/payment-health/route.ts", [
  "Monthly customer billing",
  "Invoice → Payment",
  "Stripe webhook reconciliation",
  "Company Stripe Connect",
  "Company payout ledger",
]);

const simulator = source("app/api/admin/operational-simulator/route.ts");
if (simulator.includes("image/svg+xml") || simulator.includes("operational-simulation/after.svg")) {
  throw new Error("Operational Simulator still references an unsupported SVG work photo.");
}
if (!simulator.includes('contentType: "image/png"') || !simulator.includes("operational-simulation/after.png")) {
  throw new Error("Operational Simulator PNG work-photo contract is missing.");
}

const operationalE2E = source("tests/operational-simulator.spec.ts");
if (operationalE2E.includes('getByText("Done", { exact: true })')) {
  throw new Error("Operational Simulator uses an ambiguous Done locator.");
}

const canonicalRouteE2E = source("tests/canonical-route-sync.spec.ts");
if (canonicalRouteE2E.includes('getByLabel("Email")')) {
  throw new Error("Canonical route E2E uses the ambiguous login Email label locator.");
}
if (!canonicalRouteE2E.includes('getByRole("textbox", { name: "Email" })')) {
  throw new Error("Canonical route E2E is missing the explicit Email textbox locator.");
}

console.log("PASS monthly billing, payment health, and simulator QA contracts");
