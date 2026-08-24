import { readFileSync } from "node:fs";

function source(path) { return readFileSync(path, "utf8"); }
function requireFragments(path, fragments) {
  const text = source(path);
  for (const fragment of fragments) if (!text.includes(fragment)) throw new Error(`${path} is missing required payment safety contract: ${fragment}`);
}

requireFragments("supabase/migrations/20260824001500_company_receivables_ledger.sql", [
  "company_balance_entries",
  "company_withdrawals",
  "reserve_company_withdrawal",
  "pg_advisory_xact_lock",
  "release_company_withdrawal_reservation",
  "complete_company_withdrawal",
  "Only Master can manually release company balance",
  "p_service_frequency in('weekly','biweekly','custom')",
  "v_collection:='after_visit'",
  "p_service_frequency='monthly'",
  "v_collection:='period_prepaid'",
]);

requireFragments("supabase/migrations/20260824001600_company_receivable_payout_terms.sql", [
  "normalize_company_payout_item_terms",
  "provider_payout_cents",
  "platform_fee_basis_points",
]);

requireFragments("components/payments/ContractPaymentsWorkspace.tsx", [
  "Weekly service · charged per completed Visit",
  "Biweekly service · charged per completed Visit",
  "Monthly · one charge per billing period",
  'scope === "master" && <button',
  'scope === "master" && <section',
]);

const companyPayments = source("components/payments/ContractPaymentsWorkspace.tsx");
if (companyPayments.includes('scope === "company" ? "Only company-owned customers can receive payment requests here')) {
  throw new Error("Company payment-link creation UI is still present.");
}

requireFragments("app/admin/finance/page.tsx", ["Receivables", "CompanyReceivablesWorkspace"]);
if (source("app/admin/finance/page.tsx").includes("/admin/finance/actions")) throw new Error("Company Payment Actions route is still linked from Finance.");

requireFragments("app/api/stripe/checkout/route.ts", [
  'String(profile.role) === "master"',
  "Only Master can create standalone customer payment requests",
  "billingEventId",
  "visitId",
]);

requireFragments("app/api/stripe/agreements/sync/route.ts", [
  '"weekly", "biweekly", "custom"',
  'collectionTiming: monthly ? "monthly" : "per_visit_after_service"',
  '"per_visit"',
]);

requireFragments("app/api/company/receivables/route.ts", [
  "Math.min(internalAvailableCents, stripeAvailableCents)",
  "internalAvailableCents",
  "withdrawableCents",
]);
requireFragments("app/api/company/receivables/withdraw/route.ts", [
  "reserve_company_withdrawal",
  "stripe.balance.retrieve",
  "stripe.payouts.create",
  "idempotencyKey: `company-withdrawal-${reservedWithdrawalId}`",
]);
requireFragments("app/api/cron/company-receivables/route.ts", [
  "source_transaction",
  "company-balance-transfer-${entry.id}",
  "75 * 24 * 60 * 60 * 1000",
  "complete_company_withdrawal",
]);
requireFragments("app/api/master/payment-health/route.ts", [
  "Customer billing modes",
  "Company receivables ledger",
  "On-demand withdrawals",
  "staleTransfers",
]);

const vercel = source("vercel.json");
if (vercel.includes('"/api/cron/weekly-payouts"')) throw new Error("Legacy weekly payout cron is still enabled.");
if (!vercel.includes('"/api/cron/company-receivables"')) throw new Error("Company receivables reconciliation cron is missing.");

const simulator = source("app/api/admin/operational-simulator/route.ts");
if (simulator.includes("image/svg+xml") || simulator.includes("operational-simulation/after.svg")) throw new Error("Operational Simulator still references unsupported SVG work photo.");
if (!simulator.includes('contentType: "image/png"') || !simulator.includes("operational-simulation/after.png")) throw new Error("Operational Simulator PNG work-photo contract is missing.");
const operationalE2E = source("tests/operational-simulator.spec.ts");
if (operationalE2E.includes('getByText("Done", { exact: true })')) throw new Error("Operational Simulator uses an ambiguous Done locator.");
const canonicalRouteE2E = source("tests/canonical-route-sync.spec.ts");
if (canonicalRouteE2E.includes('getByLabel("Email")')) throw new Error("Canonical route E2E uses the ambiguous login Email label locator.");
if (!canonicalRouteE2E.includes('getByRole("textbox", { name: "Email" })')) throw new Error("Canonical route E2E is missing the explicit Email textbox locator.");

console.log("PASS per-Visit/monthly billing, company receivables, withdrawal safety, payment health, and simulator QA contracts");
