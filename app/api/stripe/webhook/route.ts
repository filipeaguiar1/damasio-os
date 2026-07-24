import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

type DatabaseError = { message?: string; code?: string } | null | undefined;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function requireDatabaseSuccess(error: DatabaseError, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message || error.code || "database request failed"}`);
}

function platformFee(total: number) {
  const percent = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || "0");
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(total * percent) / 100;
}

async function claimEvent(db: any, event: Stripe.Event) {
  const inserted = await db.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
    status: "processing",
    attempts: 1,
    received_at: new Date().toISOString()
  });
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") {
    throw new Error(`Webhook event ledger unavailable: ${inserted.error.message}`);
  }

  const existing = await db
    .from("stripe_webhook_events")
    .select("status,attempts,received_at")
    .eq("event_id", event.id)
    .maybeSingle();
  requireDatabaseSuccess(existing.error, "Read webhook event");
  if (String(existing.data?.status) === "processed") return false;

  const attempts = Number(existing.data?.attempts || 1);
  const receivedAt = Date.parse(String(existing.data?.received_at || ""));
  const isActiveProcessing = String(existing.data?.status) === "processing"
    && Number.isFinite(receivedAt)
    && receivedAt > Date.now() - 10 * 60 * 1000;
  if (isActiveProcessing) return false;

  const reclaimed = await db.from("stripe_webhook_events").update({
    status: "processing",
    attempts: attempts + 1,
    last_error: null,
    received_at: new Date().toISOString()
  })
    .eq("event_id", event.id)
    .eq("status", String(existing.data?.status || "failed"))
    .eq("attempts", attempts)
    .select("event_id")
    .maybeSingle();
  requireDatabaseSuccess(reclaimed.error, "Reclaim webhook event");
  return Boolean(reclaimed.data);
}

async function finishEvent(db: any, eventId: string) {
  const result = await db.from("stripe_webhook_events").update({
    status: "processed",
    processed_at: new Date().toISOString(),
    last_error: null
  }).eq("event_id", eventId);
  requireDatabaseSuccess(result.error, "Complete webhook event");
}

async function failEvent(db: any, eventId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Webhook handler failed.";
  const result = await db.from("stripe_webhook_events").update({
    status: "failed",
    last_error: message.slice(0, 1000)
  }).eq("event_id", eventId);
  if (result.error) console.error("Could not record failed Stripe event", result.error);
}

async function markInvoicePaid(db: any, paymentIntent: Stripe.PaymentIntent) {
  const invoiceId = String(paymentIntent.metadata.invoiceId || "");
  const metadataCompanyId = String(paymentIntent.metadata.companyId || "");
  const metadataCustomerId = String(paymentIntent.metadata.customerId || "");
  if (!invoiceId || !metadataCompanyId) throw new Error("Stripe payment metadata is incomplete.");

  const invoiceResult = await db
    .from("invoices")
    .select("id,organization_id,company_id,customer_id,property_id,invoice_number,total")
    .eq("id", invoiceId)
    .maybeSingle();
  requireDatabaseSuccess(invoiceResult.error, "Load paid invoice");
  const invoice = invoiceResult.data;
  if (!invoice) throw new Error("Stripe payment references an invoice that does not exist.");

  const companyId = invoice.company_id || invoice.organization_id;
  if (companyId !== metadataCompanyId) throw new Error("Stripe payment company does not match the invoice tenant.");
  if (metadataCustomerId && invoice.customer_id && invoice.customer_id !== metadataCustomerId) {
    throw new Error("Stripe payment customer does not match the invoice.");
  }

  const amountTotal = Number(invoice.total || 0);
  const amountReceived = Number(paymentIntent.amount_received || 0) / 100;
  if (Math.abs(amountTotal - amountReceived) > 0.009) {
    throw new Error(`Stripe amount ${amountReceived.toFixed(2)} does not match invoice ${amountTotal.toFixed(2)}.`);
  }

  const fee = platformFee(amountTotal);
  const transferAmount = Math.max(0, Math.round((amountTotal - fee) * 100) / 100);
  const transferGroup = paymentIntent.transfer_group || `invoice-${invoice.id}`;
  const chargeId = typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id || null;

  const invoiceUpdate = await db.from("invoices").update({
    status: "paid",
    stripe_payment_intent_id: paymentIntent.id,
    stripe_charge_id: chargeId,
    stripe_transfer_group: transferGroup,
    stripe_platform_fee: fee,
    stripe_transfer_amount: transferAmount
  }).eq("id", invoice.id);
  requireDatabaseSuccess(invoiceUpdate.error, "Mark invoice paid");

  const existingPayment = await db
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle();
  requireDatabaseSuccess(existingPayment.error, "Find Stripe payment");

  let paymentId = existingPayment.data?.id;
  if (!paymentId) {
    const paymentInsert = await db.from("payments").insert({
      organization_id: companyId,
      company_id: companyId,
      invoice_id: invoice.id,
      customer_id: invoice.customer_id || metadataCustomerId || null,
      method: "credit_card",
      status: "paid",
      amount: amountTotal,
      reference: paymentIntent.id,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: chargeId,
      stripe_transfer_group: transferGroup,
      paid_at: new Date().toISOString(),
      notes: "Stripe Checkout payment confirmed by webhook."
    }).select("id").single();
    requireDatabaseSuccess(paymentInsert.error, "Create Stripe payment");
    paymentId = paymentInsert.data?.id;
  }
  if (!paymentId) throw new Error("Stripe payment record was not created.");

  const payoutLookup = await db
    .from("company_payout_items")
    .select("id")
    .eq("payment_id", paymentId)
    .maybeSingle();
  requireDatabaseSuccess(payoutLookup.error, "Find payout item");

  if (!payoutLookup.data) {
    const jobResult = await db
      .from("jobs")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("organization_id", companyId)
      .maybeSingle();
    requireDatabaseSuccess(jobResult.error, "Find invoice job");
    const job = jobResult.data;

    const visitResult = job?.id
      ? await db
        .from("visits")
        .select("id")
        .eq("job_id", job.id)
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .order("scheduled_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      : { data: null, error: null };
    requireDatabaseSuccess(visitResult.error, "Find invoice visit");
    const visit = visitResult.data;

    const payoutInsert = await db.from("company_payout_items").insert({
      company_id: companyId,
      invoice_id: invoice.id,
      payment_id: paymentId,
      job_id: job?.id || null,
      visit_id: visit?.id || null,
      customer_id: invoice.customer_id || metadataCustomerId || null,
      property_id: invoice.property_id || null,
      amount_total: amountTotal,
      platform_fee: fee,
      transfer_amount: transferAmount,
      status: "pending_feedback",
      hold_reason: visit?.id
        ? "Waiting for completed service feedback or 3 days without open tasks."
        : "Waiting for a completed service visit before payout release.",
      eligible_at: null,
      stripe_transfer_group: transferGroup
    });
    requireDatabaseSuccess(payoutInsert.error, "Create payout item");
  }

  const activity = await db.from("activity_log").insert({
    organization_id: companyId,
    company_id: companyId,
    action: "stripe.payment_confirmed",
    entity_type: "invoice",
    entity_id: invoice.id,
    details: `Stripe payment ${paymentIntent.id} confirmed. Weekly payout item prepared.`
  });
  if (activity.error) console.error("Stripe payment activity log failed", activity.error);
}

async function markPaymentFailed(db: any, intent: Stripe.PaymentIntent) {
  const invoiceId = String(intent.metadata.invoiceId || "");
  const companyId = String(intent.metadata.companyId || "");
  if (!invoiceId || !companyId) throw new Error("Failed payment metadata is incomplete.");

  const invoiceUpdate = await db
    .from("invoices")
    .update({ status: "waiting_payment", stripe_payment_intent_id: intent.id })
    .eq("id", invoiceId)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  requireDatabaseSuccess(invoiceUpdate.error, "Restore failed invoice");

  const existing = await db.from("payments").select("id").eq("stripe_payment_intent_id", intent.id).maybeSingle();
  requireDatabaseSuccess(existing.error, "Find failed Stripe payment");
  if (existing.data) return;

  const failedInsert = await db.from("payments").insert({
    organization_id: companyId,
    company_id: companyId,
    invoice_id: invoiceId,
    customer_id: intent.metadata.customerId || null,
    method: "credit_card",
    status: "failed",
    amount: Math.round(Number(intent.amount || 0)) / 100,
    reference: intent.id,
    stripe_payment_intent_id: intent.id,
    failure_code: intent.last_payment_error?.code || null,
    failure_message: intent.last_payment_error?.message || null
  });
  requireDatabaseSuccess(failedInsert.error, "Record failed Stripe payment");
}

async function updateConnectedAccount(db: any, account: Stripe.Account) {
  const transfersActive = account.capabilities?.transfers === "active";
  const enabled = Boolean(account.details_submitted && account.payouts_enabled && transfersActive);
  const disabled = Boolean(account.requirements?.disabled_reason);
  const status = enabled ? "enabled" : disabled ? "restricted" : "onboarding";
  const now = new Date().toISOString();
  const update = await db.from("organizations").update({
    stripe_connect_status: status,
    stripe_connect_onboarded_at: account.details_submitted ? now : null,
    stripe_payouts_enabled_at: enabled ? now : null
  }).eq("stripe_connected_account_id", account.id);
  requireDatabaseSuccess(update.error, "Update connected account");
}

async function handleRefundOrDispute(db: any, event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  const status = event.type === "charge.refunded" ? "refunded" : "disputed";
  const reason = event.type === "charge.refunded" ? "Stripe charge refunded." : "Stripe dispute opened.";
  let payoutUpdate;
  if (charge.transfer_group) {
    payoutUpdate = await db.from("company_payout_items").update({
      status,
      hold_reason: reason,
      updated_at: new Date().toISOString()
    }).eq("stripe_transfer_group", charge.transfer_group);
  } else {
    const payment = await db.from("payments").select("id").eq("stripe_charge_id", charge.id).maybeSingle();
    requireDatabaseSuccess(payment.error, "Find refunded or disputed payment");
    if (!payment.data?.id) throw new Error("Stripe charge is not linked to a payment.");
    payoutUpdate = await db.from("company_payout_items").update({
      status,
      hold_reason: reason,
      updated_at: new Date().toISOString()
    }).eq("payment_id", payment.data.id);
  }
  requireDatabaseSuccess(payoutUpdate.error, "Hold refunded or disputed payout");

  if (event.type === "charge.refunded") {
    const paymentUpdate = await db.from("payments").update({ status: "refunded" }).eq("stripe_charge_id", charge.id);
    requireDatabaseSuccess(paymentUpdate.error, "Update refunded payment");
  }
}

async function expireCheckout(db: any, session: Stripe.Checkout.Session) {
  const invoiceId = String(session.metadata?.invoiceId || "");
  if (!invoiceId) return;
  const result = await db.from("invoices").update({ status: "waiting_payment" })
    .eq("id", invoiceId)
    .eq("status", "processing")
    .eq("stripe_checkout_session_id", session.id);
  requireDatabaseSuccess(result.error, "Restore expired checkout");
}

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecrets = Array.from(new Set([
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  ].filter((secret): secret is string => Boolean(secret))));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !webhookSecrets.length || !url || !serviceKey) {
    const missing = [
      !stripeKey && "STRIPE_SECRET_KEY",
      !webhookSecrets.length && "STRIPE_WEBHOOK_SECRET or STRIPE_CONNECT_WEBHOOK_SECRET",
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    console.error("Stripe webhook configuration missing", missing);
    return bad("Stripe webhook is not configured.", 503);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return bad("Missing Stripe signature.");

  const payload = await request.text();
  let event: Stripe.Event | null = null;
  let signatureError: unknown;
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
      break;
    } catch (error) {
      signatureError = error;
    }
  }
  if (!event) {
    console.error("Invalid Stripe webhook signature", signatureError);
    return bad("Invalid Stripe signature.");
  }

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as any;

  try {
    const shouldProcess = await claimEvent(db, event);
    if (!shouldProcess) return NextResponse.json({ received: true, duplicate: true });

    switch (event.type) {
      case "payment_intent.succeeded":
        await markInvoicePaid(db, event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.payment_failed":
        await markPaymentFailed(db, event.data.object as Stripe.PaymentIntent);
        break;
      case "checkout.session.expired":
        await expireCheckout(db, event.data.object as Stripe.Checkout.Session);
        break;
      case "account.updated":
        await updateConnectedAccount(db, event.data.object as Stripe.Account);
        break;
      case "charge.refunded":
      case "charge.dispute.created":
        await handleRefundOrDispute(db, event);
        break;
      default:
        break;
    }

    await finishEvent(db, event.id);
  } catch (error) {
    await failEvent(db, event.id, error);
    console.error("Stripe webhook handler failed", event.type, error);
    return bad("Webhook handler failed.", 500);
  }

  return NextResponse.json({ received: true });
}
