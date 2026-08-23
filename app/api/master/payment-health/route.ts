import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

type Status = "healthy" | "warning" | "critical";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Payment Health database access is not configured.");
  return { url, anonKey, serviceKey };
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const { url, anonKey, serviceKey } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await authClient
    .from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") {
    throw new Error("Only an active Master can view Payment Health.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function countBy(rows: any[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row?.[key] ?? "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function worst(statuses: Status[]): Status {
  return statuses.includes("critical") ? "critical" : statuses.includes("warning") ? "warning" : "healthy";
}

export async function GET(request: NextRequest) {
  try {
    const db = await requireMaster(request);
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const config = {
      stripeSecret: Boolean(stripeKey),
      stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      stripeConnectWebhook: Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
      siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
      platformFeeConfigured: Number.isFinite(Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || "")),
    };

    let stripeReachable = false;
    let stripeMode: "live" | "test" | "unavailable" = "unavailable";
    let stripeError: string | null = null;
    if (stripeKey) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
        const balance = await stripe.balance.retrieve();
        stripeReachable = true;
        stripeMode = balance.livemode ? "live" : "test";
      } catch (error) {
        stripeError = error instanceof Error ? error.message.slice(0, 300) : "Stripe API could not be reached.";
      }
    }

    const [
      organizationsResult,
      invoicesResult,
      paymentsResult,
      webhooksResult,
      agreementsResult,
      cyclesResult,
      payoutItemsResult,
      payoutBatchesResult,
    ] = await Promise.all([
      db.from("organizations").select("id,active,stripe_connect_status,stripe_connected_account_id,stripe_payouts_enabled_at").is("deleted_at", null).limit(5000),
      db.from("invoices").select("id,status,total,created_at,stripe_payment_intent_id,stripe_checkout_session_id,billing_cycle_id").order("created_at", { ascending: false }).limit(5000),
      db.from("payments").select("id,status,amount,invoice_id,stripe_payment_intent_id,created_at").order("created_at", { ascending: false }).limit(5000),
      db.from("stripe_webhook_events").select("event_id,event_type,status,attempts,last_error,received_at,processed_at").order("received_at", { ascending: false }).limit(250),
      db.from("billing_agreements").select("id,active,payment_status,collection_timing,billing_model,service_frequency,stripe_sync_status").eq("active", true).limit(5000),
      db.from("billing_cycles").select("id,state,charge_due_on,period_starts_on,period_ends_on,last_error,created_at").order("created_at", { ascending: false }).limit(5000),
      db.from("company_payout_items").select("id,status,invoice_id,payment_id,transfer_amount,stripe_transfer_id,batch_id,created_at").order("created_at", { ascending: false }).limit(5000),
      db.from("company_payout_batches").select("id,status,total_transfer_amount,stripe_transfer_ids,scheduled_payout_date,created_at").order("created_at", { ascending: false }).limit(2000),
    ]);

    for (const result of [organizationsResult, invoicesResult, paymentsResult, webhooksResult, agreementsResult, cyclesResult, payoutItemsResult, payoutBatchesResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const organizations = organizationsResult.data || [];
    const invoices = invoicesResult.data || [];
    const payments = paymentsResult.data || [];
    const webhooks = webhooksResult.data || [];
    const agreements = agreementsResult.data || [];
    const cycles = cyclesResult.data || [];
    const payoutItems = payoutItemsResult.data || [];
    const payoutBatches = payoutBatchesResult.data || [];

    const paidPaymentsByInvoice = new Map<string, any>();
    for (const payment of payments) {
      if (payment.invoice_id && payment.status === "paid") paidPaymentsByInvoice.set(String(payment.invoice_id), payment);
    }

    const paidInvoicesWithoutPayment = invoices.filter((invoice: any) => invoice.status === "paid" && !paidPaymentsByInvoice.has(String(invoice.id)));
    const amountMismatches = invoices.filter((invoice: any) => {
      if (invoice.status !== "paid") return false;
      const payment = paidPaymentsByInvoice.get(String(invoice.id));
      return payment && Math.abs(Number(invoice.total || 0) - Number(payment.amount || 0)) > 0.009;
    });
    const staleProcessingCutoff = Date.now() - 45 * 60 * 1000;
    const staleProcessing = invoices.filter((invoice: any) => invoice.status === "processing" && new Date(invoice.created_at).getTime() < staleProcessingCutoff);
    const failedWebhooks = webhooks.filter((event: any) => event.status === "failed");
    const staleWebhooks = webhooks.filter((event: any) => event.status === "processing" && new Date(event.received_at).getTime() < Date.now() - 10 * 60 * 1000);
    const monthlyAgreements = agreements.filter((agreement: any) => agreement.collection_timing === "period_prepaid" && agreement.billing_model === "monthly_fixed_subscription" && agreement.payment_status === "active");
    const legacyRecurring = agreements.filter((agreement: any) => agreement.collection_timing === "after_visit" && agreement.service_frequency !== "one_time");
    const failedCycles = cycles.filter((cycle: any) => cycle.state === "payment_failed");
    const dueUnpaidCycles = cycles.filter((cycle: any) => ["invoice_pending", "payment_failed"].includes(String(cycle.state)) && String(cycle.charge_due_on) <= new Date().toISOString().slice(0, 10));
    const badTransferredItems = payoutItems.filter((item: any) => item.status === "transferred" && !item.stripe_transfer_id);
    const failedBatches = payoutBatches.filter((batch: any) => batch.status === "failed");

    const connectEnabled = organizations.filter((org: any) => org.stripe_connect_status === "enabled" && org.stripe_connected_account_id && org.stripe_payouts_enabled_at).length;
    const activeCompanies = organizations.filter((org: any) => org.active !== false).length;
    const connectStatus = countBy(organizations, "stripe_connect_status");

    const stages: Array<{ key: string; label: string; status: Status; detail: string }> = [];
    stages.push({
      key: "stripe",
      label: "Stripe API",
      status: stripeReachable && config.stripeWebhook ? "healthy" : "critical",
      detail: stripeReachable ? `Stripe ${stripeMode.toUpperCase()} reachable and signed webhook ${config.stripeWebhook ? "configured" : "missing"}.` : stripeError || "Stripe secret is missing.",
    });
    stages.push({
      key: "monthly",
      label: "Monthly customer billing",
      status: legacyRecurring.length ? "critical" : failedCycles.length ? "warning" : "healthy",
      detail: `${monthlyAgreements.length} active monthly agreement(s), ${dueUnpaidCycles.length} due/unpaid cycle(s), ${legacyRecurring.length} recurring per-Visit agreement(s).`,
    });
    stages.push({
      key: "invoice",
      label: "Invoice → Payment",
      status: paidInvoicesWithoutPayment.length || amountMismatches.length ? "critical" : staleProcessing.length ? "warning" : "healthy",
      detail: `${invoices.length} invoice(s), ${payments.length} payment record(s), ${staleProcessing.length} stale processing checkout(s).`,
    });
    stages.push({
      key: "webhook",
      label: "Stripe webhook reconciliation",
      status: failedWebhooks.length || staleWebhooks.length ? "critical" : "healthy",
      detail: `${webhooks.length} recent event(s); ${failedWebhooks.length} failed and ${staleWebhooks.length} stale processing.`,
    });
    stages.push({
      key: "connect",
      label: "Company Stripe Connect",
      status: activeCompanies > 0 && connectEnabled === 0 ? "critical" : connectEnabled < activeCompanies ? "warning" : "healthy",
      detail: `${connectEnabled}/${activeCompanies} active company account(s) enabled for payouts.`,
    });
    stages.push({
      key: "payout",
      label: "Company payout ledger",
      status: failedBatches.length || badTransferredItems.length ? "critical" : "healthy",
      detail: `${payoutItems.length} payout item(s), ${payoutBatches.length} batch(es), ${failedBatches.length} failed batch(es).`,
    });

    const issues: Array<{ severity: Status; code: string; message: string }> = [];
    if (!stripeReachable) issues.push({ severity: "critical", code: "stripe_unreachable", message: stripeError || "Stripe API is not reachable from production." });
    if (!config.stripeWebhook) issues.push({ severity: "critical", code: "webhook_secret_missing", message: "STRIPE_WEBHOOK_SECRET is not configured." });
    if (!config.stripeConnectWebhook) issues.push({ severity: "warning", code: "connect_webhook_missing", message: "STRIPE_CONNECT_WEBHOOK_SECRET is not configured; company capability changes cannot reconcile automatically." });
    if (!config.cronSecret) issues.push({ severity: "critical", code: "cron_secret_missing", message: "CRON_SECRET is missing; monthly billing and scheduled payouts cannot run safely." });
    if (legacyRecurring.length) issues.push({ severity: "critical", code: "legacy_per_visit", message: `${legacyRecurring.length} recurring agreement(s) still use per-Visit collection and are blocked until resaved as monthly.` });
    if (failedCycles.length) issues.push({ severity: "warning", code: "monthly_cycle_failed", message: `${failedCycles.length} monthly billing cycle(s) are in payment_failed state.` });
    if (paidInvoicesWithoutPayment.length) issues.push({ severity: "critical", code: "invoice_without_payment", message: `${paidInvoicesWithoutPayment.length} paid invoice(s) have no matching paid payment ledger entry.` });
    if (amountMismatches.length) issues.push({ severity: "critical", code: "amount_mismatch", message: `${amountMismatches.length} paid invoice/payment amount mismatch(es) were detected.` });
    if (failedWebhooks.length) issues.push({ severity: "critical", code: "failed_webhook", message: `${failedWebhooks.length} recent Stripe webhook event(s) failed reconciliation.` });
    if (activeCompanies > 0 && connectEnabled === 0) issues.push({ severity: "critical", code: "connect_not_ready", message: "No active company has Stripe Connect payouts enabled yet. Customer collection can work, but company money cannot be transferred." });
    if (failedBatches.length) issues.push({ severity: "critical", code: "payout_batch_failed", message: `${failedBatches.length} company payout batch(es) failed.` });
    if (badTransferredItems.length) issues.push({ severity: "critical", code: "transfer_id_missing", message: `${badTransferredItems.length} transferred payout item(s) are missing a Stripe transfer id.` });

    const overallStatus = worst(stages.map((stage) => stage.status));
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      overallStatus,
      stripe: { reachable: stripeReachable, mode: stripeMode, error: stripeError },
      config,
      stages,
      issues,
      metrics: {
        organizations: organizations.length,
        activeCompanies,
        connectEnabled,
        connectStatus,
        invoices: countBy(invoices, "status"),
        payments: countBy(payments, "status"),
        webhooks: countBy(webhooks, "status"),
        agreements: { active: agreements.length, monthly: monthlyAgreements.length, legacyRecurring: legacyRecurring.length },
        cycles: countBy(cycles, "state"),
        payouts: countBy(payoutItems, "status"),
        payoutBatches: countBy(payoutBatches, "status"),
        reconciliation: {
          paidInvoicesWithoutPayment: paidInvoicesWithoutPayment.length,
          amountMismatches: amountMismatches.length,
          staleProcessing: staleProcessing.length,
        },
      },
      recentWebhookFailures: failedWebhooks.slice(0, 10).map((event: any) => ({
        eventType: event.event_type,
        attempts: event.attempts,
        error: String(event.last_error || "Unknown webhook error").slice(0, 300),
        receivedAt: event.received_at,
      })),
    });
  } catch (error) {
    console.error("Payment Health failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment Health could not be loaded." }, { status: 401 });
  }
}
