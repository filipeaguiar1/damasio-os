import { readFileSync } from "node:fs";

function source(path) { return readFileSync(path, "utf8"); }
function requireFragments(path, fragments) {
  const text = source(path);
  for (const fragment of fragments) if (!text.includes(fragment)) throw new Error(`${path} is missing required payment safety contract: ${fragment}`);
}

requireFragments("supabase/migrations/20260824001500_company_receivables_ledger.sql", [
  "company_balance_entries", "company_withdrawals", "reserve_company_withdrawal", "pg_advisory_xact_lock",
  "release_company_withdrawal_reservation", "complete_company_withdrawal", "Only Master can manually release company balance",
  "p_service_frequency in('weekly','biweekly','custom')", "v_collection:='after_visit'", "p_service_frequency='monthly'", "v_collection:='period_prepaid'",
]);
requireFragments("supabase/migrations/20260824001600_company_receivable_payout_terms.sql", ["normalize_company_payout_item_terms", "provider_payout_cents", "platform_fee_basis_points"]);
requireFragments("supabase/migrations/20260824001700_external_payout_reconciliation.sql", ["reserve_external_company_payout", "stripe_payout_reconciliation_hold", "stripe_dashboard", "manual_description", "clear_company_payout_reconciliation_hold"]);
requireFragments("supabase/migrations/20260824001800_manual_invoice_visit_payout_link.sql", ["attach_manual_invoice_visit_to_payout_item", "new.visit_id:=v_visit", "Waiting for completed service feedback or 3 days without open tasks."]);
requireFragments("supabase/migrations/20260824001900_payment_audit_hardening.sql", [
  "customer_notification_attempted_at", "v_invoice_visit", "Master reconciliation required: no canonical payout terms",
  "status::text in('paid','succeeded')", "status='disputed'", "accept_customer_payment_dispute_resolution", "refresh_payout_release_status",
]);
requireFragments("supabase/migrations/20260824002000_master_manual_invoice_idempotency.sql", [
  "manual_request_id", "invoices_manual_request_id_unique", "create_master_manual_invoice",
  "Manual invoice idempotency key was already used for a different request", "master_audit_log",
]);

requireFragments("components/payments/ContractPaymentsWorkspace.tsx", [
  "Weekly service · charged per completed Visit", "Biweekly service · charged per completed Visit", "Monthly · one charge per billing period",
  'scope === "master" && <button', 'scope === "master" && <section',
]);
const companyPayments = source("components/payments/ContractPaymentsWorkspace.tsx");
if (companyPayments.includes('scope === "company" ? "Only company-owned customers can receive payment requests here')) throw new Error("Company payment-link creation UI is still present.");

requireFragments("app/admin/finance/page.tsx", ["Receivables", "CompanyReceivablesWorkspace"]);
if (source("app/admin/finance/page.tsx").includes("/admin/finance/actions")) throw new Error("Company Payment Actions route is still linked from Finance.");
requireFragments("app/api/admin/payments/actions/route.ts", ["Standalone payment requests are Master-only", "action === \"advance\""]);

requireFragments("app/api/stripe/checkout/route.ts", [
  "Checkout never creates money obligations",
  "Create or select an invoice before starting card checkout.",
  "invoiceId",
  "billingEventId",
  "visitId",
  "checkout.sessions.create",
]);
const checkout = source("app/api/stripe/checkout/route.ts");
if (checkout.includes("createManualInvoice") || checkout.includes("body.amountCents") || checkout.includes("customerId?: string; amountCents")) {
  throw new Error("Stripe Checkout can still create or price a standalone invoice instead of consuming a canonical invoice.");
}
requireFragments("app/api/stripe/agreements/sync/route.ts", ['"weekly", "biweekly", "custom"', 'collectionTiming: monthly ? "monthly" : "per_visit_after_service"', '"per_visit"']);
requireFragments("app/api/stripe/webhook/route.ts", ["reconcileConnectedPayout", 'case "payout.created"', 'case "payout.paid"', 'case "payout.failed"', "stripe_webhook_events"]);
requireFragments("lib/stripe/reconcileConnectedPayout.ts", [
  "reserve_external_company_payout", "complete_external_company_withdrawal", "release_company_withdrawal_reservation",
  "reservedWithdrawalFromMetadata", "payout.metadata?.withdrawalId", "localRecoveryHold",
]);

requireFragments("app/api/company/receivables/route.ts", ["Math.min(internalAvailableCents, stripeAvailableCents)", "stripe_payout_reconciliation_hold", "withdrawableCents"]);
requireFragments("app/api/company/receivables/withdraw/route.ts", [
  "reserve_company_withdrawal", "stripe.balance.retrieve", "stripe.payouts.create", "stripe_payout_reconciliation_hold",
  "idempotencyKey: `company-withdrawal-${reservedWithdrawalId}`", 'let stripePayoutId = ""',
  "Once Stripe accepted the payout", "local_reconciliation_pending", "withdrawals are locked until reconciliation completes",
]);
requireFragments("app/api/cron/company-receivables/route.ts", ["source_transaction", "company-balance-transfer-${entry.id}", "75 * 24 * 60 * 60 * 1000", "complete_company_withdrawal"]);

requireFragments("app/api/master/manual-invoices/route.ts", [
  "requestId", "create_master_manual_invoice", "Only an active Master can create manual customer invoices",
  'String(visit.status) !== "completed"', "idempotencyKey: `manual-invoice-${body.requestId}`",
  "tax included", "sendBrandedEmail", "customer_notification_attempted_at",
]);
const manualInvoiceApi = source("app/api/master/manual-invoices/route.ts");
if (manualInvoiceApi.includes(".from(\"invoices\").insert(")) throw new Error("Master manual invoice API bypasses the transactional idempotent database RPC.");
requireFragments("components/payments/MasterManualInvoiceWorkspace.tsx", [
  "Create & send invoice", "completed Visit", "This does not charge a stored card automatically",
  "manualRequestId", "crypto.randomUUID()", "network retry cannot create a duplicate invoice",
]);
requireFragments("lib/server/brandedEmail.ts", ["idempotencyKey?: string", '"Idempotency-Key"']);
requireFragments("app/api/customer/payment-disputes/route.ts", ["accept_customer_payment_dispute_resolution", 'status: "escalated"']);
requireFragments("app/api/master/payout-reconciliation/route.ts", ["clear_company_payout_reconciliation_hold", "payout.reconciliation_hold_cleared"]);
requireFragments("app/api/master/payment-health/route.ts", ["Customer billing modes", "Company receivables ledger", "On-demand & external payouts", "external_payout_unmatched", "payout_reconciliation_hold"]);

const vercel = source("vercel.json");
if (vercel.includes('"/api/cron/weekly-payouts"')) throw new Error("Legacy weekly payout cron is still enabled.");
if (!vercel.includes('"/api/cron/company-receivables"')) throw new Error("Company receivables reconciliation cron is missing.");

const simulator = source("app/api/admin/operational-simulator/route.ts");
if (simulator.includes("image/svg+xml") || simulator.includes("operational-simulation/after.svg")) throw new Error("Operational Simulator still references unsupported SVG work photo.");
if (!simulator.includes('contentType: "image/png"') || !simulator.includes("operational-simulation/after.png")) throw new Error("Operational Simulator PNG work-photo contract is missing.");
requireFragments("lib/simulator/safeAdvancedSimulationPhotos.ts", ["SAFE_SIMULATION_PNG", 'contentType: "image/png"', 'replace(/\\/after\\.svg$/i, "/after.png")']);
requireFragments("app/api/admin/operational-simulator/v2/route.ts", ["withSafeAdvancedSimulationPhotos", "const simulationService = withSafeAdvancedSimulationPhotos(service)", "createAdvancedSimulationData(simulationService"]);
const operationalE2E = source("tests/operational-simulator.spec.ts");
if (operationalE2E.includes('getByText("Done", { exact: true })')) throw new Error("Operational Simulator uses an ambiguous Done locator.");
const canonicalRouteE2E = source("tests/canonical-route-sync.spec.ts");
if (canonicalRouteE2E.includes('getByLabel("Email")')) throw new Error("Canonical route E2E uses the ambiguous login Email label locator.");
if (!canonicalRouteE2E.includes('getByRole("textbox", { name: "Email" })')) throw new Error("Canonical route E2E is missing the explicit Email textbox locator.");
if (canonicalRouteE2E.includes('getByText("Create, add, reorder or remove houses.")')) throw new Error("Canonical route E2E still depends on retired Advisor copy.");
if (canonicalRouteE2E.includes('tab=advisor') || canonicalRouteE2E.includes('advisor-house-picker') || canonicalRouteE2E.includes('advisor-controls')) throw new Error("Canonical route E2E still targets the retired Advisor UI.");

console.log("PASS canonical invoice-only Checkout, idempotent Master invoices, per-Visit/monthly billing, dispute holds, company receivables, post-Stripe payout recovery, external payout reconciliation, withdrawal safety, payment health, and simulator QA contracts");
