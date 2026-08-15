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

function missingColumn(error: DatabaseError, column: string) {
  const message = String(error?.message || "").toLowerCase();
  return (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
    && message.includes(column.toLowerCase());
}

async function insertCompanyCompatible(
  db: any,
  table: string,
  row: Record<string, unknown>,
  selectColumns?: string,
) {
  const execute = async (value: Record<string, unknown>) => {
    const query = db.from(table).insert(value);
    return selectColumns ? query.select(selectColumns).single() : query;
  };
  let result = await execute(row);
  if (result.error && missingColumn(result.error, "company_id")) {
    const { company_id: _companyId, ...legacyRow } = row;
    result = await execute(legacyRow);
  }
  return result;
}

async function loadInvoice(db: any, invoiceId: string) {
  let result = await db
    .from("invoices")
    .select("id,organization_id,company_id,customer_id,property_id,invoice_number,total,status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (result.error && missingColumn(result.error, "company_id")) {
    result = await db
      .from("invoices")
      .select("id,organization_id,customer_id,property_id,invoice_number,total,status")
      .eq("id", invoiceId)
      .maybeSingle();
  }
  return result;
}

async function updateInvoiceForTenant(
  db: any,
  invoiceId: string,
  companyId: string,
  values: Record<string, unknown>,
) {
  let result = await db.from("invoices")
    .update(values)
    .eq("id", invoiceId)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if (result.error && missingColumn(result.error, "company_id")) {
    result = await db.from("invoices")
      .update(values)
      .eq("id", invoiceId)
      .eq("organization_id", companyId);
  }
  return result;
}

function platformFee(total: number) {
  const percent = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || "0");
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(total * percent) / 100;
}

function depositInvoiceNumber(paymentIntentId: string) {
  const suffix = paymentIntentId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase();
  return `DEP-${suffix}`;
}

async function claimEvent(db: any, event: Stripe.Event) {
  const inserted = await db.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
    status: "processing",
    attempts: 1,
    received_at: new Date().toISOString(),
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
    received_at: new Date().toISOString(),
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
    last_error: null,
  }).eq("event_id", eventId);
  requireDatabaseSuccess(result.error, "Complete webhook event");
}

async function failEvent(db: any, eventId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Webhook handler failed.";
  const result = await db.from("stripe_webhook_events").update({
    status: "failed",
    last_error: message.slice(0, 1000),
  }).eq("event_id", eventId);
  if (result.error) console.error("Could not record failed Stripe event", result.error);
}

async function canonicalCustomer(
  db: any,
  metadata: { customerId?: string; profileId?: string; companyId?: string },
) {
  const customerId = String(metadata.customerId || "");
  const profileId = String(metadata.profileId || "");
  const metadataCompanyId = String(metadata.companyId || "");
  if (!customerId) throw new Error("Stripe customer metadata is incomplete.");

  const customerResult = await db.from("customers")
    .select("id,profile_id,company_id,organization_id,archived_at")
    .eq("id", customerId)
    .maybeSingle();
  requireDatabaseSuccess(customerResult.error, "Load Stripe Customer");
  const customer = customerResult.data;
  if (!customer || customer.archived_at) throw new Error("Stripe payment references an unavailable Customer.");

  const companyId = String(customer.company_id || customer.organization_id || "");
  if (metadataCompanyId && companyId && metadataCompanyId !== companyId) {
    throw new Error("Stripe Customer company metadata does not match canonical ownership.");
  }
  if (profileId && customer.profile_id && String(customer.profile_id) !== profileId) {
    throw new Error("Stripe Customer profile metadata does not match canonical ownership.");
  }

  if (profileId) {
    const profileResult = await db.from("profiles")
      .select("id,role,active,company_id,organization_id")
      .eq("id", profileId)
      .maybeSingle();
    requireDatabaseSuccess(profileResult.error, "Load Stripe Customer profile");
    if (!profileResult.data?.active || profileResult.data.role !== "customer") {
      throw new Error("Stripe Customer profile is not an active Customer account.");
    }
    const profileCompanyId = String(profileResult.data.company_id || profileResult.data.organization_id || "");
    if (profileCompanyId && companyId && profileCompanyId !== companyId) {
      throw new Error("Stripe Customer profile company does not match canonical ownership.");
    }
  }

  return { customerId: String(customer.id), companyId: companyId || null, profileId: profileId || null };
}

async function markInvoicePaid(db: any, paymentIntent: Stripe.PaymentIntent) {
  const invoiceId = String(paymentIntent.metadata.invoiceId || "");
  const metadataCompanyId = String(paymentIntent.metadata.companyId || "");
  const metadataCustomerId = String(paymentIntent.metadata.customerId || "");
  if (!invoiceId || !metadataCompanyId) throw new Error("Stripe payment metadata is incomplete.");

  const invoiceResult = await loadInvoice(db, invoiceId);
  requireDatabaseSuccess(invoiceResult.error, "Load paid invoice");
  const invoice = invoiceResult.data;
  if (!invoice) throw new Error("Stripe payment references an invoice that does not exist.");

  const companyId = String(invoice.company_id || invoice.organization_id || "");
  if (companyId !== metadataCompanyId) throw new Error("Stripe payment company does not match the invoice tenant.");
  if (metadataCustomerId && invoice.customer_id && String(invoice.customer_id) !== metadataCustomerId) {
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
    stripe_transfer_amount: transferAmount,
  }).eq("id", invoice.id);
  requireDatabaseSuccess(invoiceUpdate.error, "Mark invoice paid");

  const existingPayment = await db.from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle();
  requireDatabaseSuccess(existingPayment.error, "Find Stripe payment");

  let paymentId = existingPayment.data?.id;
  if (!paymentId) {
    const paymentInsert = await insertCompanyCompatible(db, "payments", {
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
      notes: "Stripe Checkout payment confirmed by webhook.",
    }, "id");
    requireDatabaseSuccess(paymentInsert.error, "Create Stripe payment");
    paymentId = paymentInsert.data?.id;
  }
  if (!paymentId) throw new Error("Stripe payment record was not created.");

  const payoutLookup = await db.from("company_payout_items")
    .select("id")
    .eq("payment_id", paymentId)
    .maybeSingle();
  requireDatabaseSuccess(payoutLookup.error, "Find payout item");

  if (!payoutLookup.data) {
    const jobResult = await db.from("jobs")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("organization_id", companyId)
      .maybeSingle();
    requireDatabaseSuccess(jobResult.error, "Find invoice job");
    const job = jobResult.data;

    let visitResult: any = { data: null, error: null };
    if (job?.id) {
      visitResult = await db.from("visits")
        .select("id")
        .eq("job_id", job.id)
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .order("scheduled_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (visitResult.error && missingColumn(visitResult.error, "company_id")) {
        visitResult = await db.from("visits")
          .select("id")
          .eq("job_id", job.id)
          .eq("organization_id", companyId)
          .order("scheduled_date", { ascending: false })
          .limit(1)
          .maybeSingle();
      }
    }
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
      stripe_transfer_group: transferGroup,
    });
    requireDatabaseSuccess(payoutInsert.error, "Create payout item");
  }

  const activity = await insertCompanyCompatible(db, "activity_log", {
    organization_id: companyId,
    company_id: companyId,
    action: "stripe.payment_confirmed",
    entity_type: "invoice",
    entity_id: invoice.id,
    details: `Stripe payment ${paymentIntent.id} confirmed. Payout item prepared.`,
  });
  if (activity.error) console.error("Stripe payment activity log failed", activity.error);
}

async function markCustomerTipPaid(db: any, paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const amountCents = Number(metadata.amountCents || paymentIntent.amount_received || paymentIntent.amount || 0);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) throw new Error("Stripe tip amount is invalid.");
  if (Number(paymentIntent.amount_received || 0) !== amountCents) throw new Error("Stripe tip amount does not match metadata.");

  const identity = await canonicalCustomer(db, {
    customerId: metadata.customerId,
    profileId: metadata.profileId,
    companyId: metadata.companyId,
  });

  const existing = await db.from("customer_tips")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle();
  requireDatabaseSuccess(existing.error, "Find Stripe customer tip");
  if (existing.data?.id) return;

  const inserted = await db.from("customer_tips").insert({
    customer_id: identity.customerId,
    company_id: identity.companyId,
    amount_cents: amountCents,
    stripe_payment_intent_id: paymentIntent.id,
    payment_method: "card",
    status: "paid",
    note: String(metadata.note || "").slice(0, 200) || null,
  });
  requireDatabaseSuccess(inserted.error, "Create Stripe customer tip");
}

async function markWalletTopupPaid(db: any, paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const amountCents = Number(metadata.amountCents || paymentIntent.amount_received || paymentIntent.amount || 0);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) throw new Error("Stripe wallet top-up amount is invalid.");
  if (Number(paymentIntent.amount_received || 0) !== amountCents) {
    throw new Error("Stripe wallet top-up amount does not match metadata.");
  }

  const identity = await canonicalCustomer(db, {
    customerId: metadata.customerId,
    profileId: metadata.profileId,
    companyId: metadata.companyId,
  });

  const { data, error } = await db.rpc("credit_customer_wallet", {
    p_company_id: identity.companyId,
    p_customer_id: identity.customerId,
    p_amount_cents: amountCents,
    p_stripe_payment_intent_id: paymentIntent.id,
    p_description: `${(amountCents / 100).toFixed(2)} CAD account deposit paid with Stripe`,
  });
  requireDatabaseSuccess(error, "Credit wallet top-up");

  const result = Array.isArray(data) ? data[0] : data;
  if (result && result.credited === false) return;

  const transaction = await db.from("customer_wallet_transactions")
    .select("id")
    .eq("customer_id", identity.customerId)
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle();
  requireDatabaseSuccess(transaction.error, "Find wallet top-up transaction");
  if (!transaction.data?.id) throw new Error("Wallet top-up transaction could not be found.");

  const depositInvoice = await db.from("customer_deposit_invoices").upsert({
    customer_id: identity.customerId,
    company_id: identity.companyId,
    wallet_transaction_id: transaction.data.id,
    invoice_number: depositInvoiceNumber(paymentIntent.id),
    status: "paid",
    amount_cents: amountCents,
    stripe_payment_intent_id: paymentIntent.id,
  }, { onConflict: "stripe_payment_intent_id" });
  requireDatabaseSuccess(depositInvoice.error, "Create wallet top-up invoice");
}

async function markPaymentFailed(db: any, intent: Stripe.PaymentIntent) {
  if (intent.metadata?.paymentKind === "customer_tip" || intent.metadata?.paymentKind === "wallet_topup") return;
  const invoiceId = String(intent.metadata.invoiceId || "");
  const companyId = String(intent.metadata.companyId || "");
  if (!invoiceId || !companyId) throw new Error("Failed payment metadata is incomplete.");

  const invoiceUpdate = await updateInvoiceForTenant(db, invoiceId, companyId, {
    status: "waiting_payment",
    stripe_payment_intent_id: intent.id,
  });
  requireDatabaseSuccess(invoiceUpdate.error, "Restore failed invoice");

  const existing = await db.from("payments").select("id").eq("stripe_payment_intent_id", intent.id).maybeSingle();
  requireDatabaseSuccess(existing.error, "Find failed Stripe payment");
  if (existing.data) return;

  const failedInsert = await insertCompanyCompatible(db, "payments", {
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
    failure_message: intent.last_payment_error?.message || null,
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
    stripe_payouts_enabled_at: enabled ? now : null,
  }).eq("stripe_connected_account_id", account.id);
  requireDatabaseSuccess(update.error, "Update connected account");
}

function paymentIntentIdFromCharge(charge: Stripe.Charge) {
  return typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id || "";
}

async function chargeFromFinancialEvent(stripe: Stripe, event: Stripe.Event) {
  if (event.type === "charge.refunded") {
    return { charge: event.data.object as Stripe.Charge, dispute: null as Stripe.Dispute | null };
  }
  const dispute = event.data.object as Stripe.Dispute;
  const chargeRef = dispute.charge;
  if (!chargeRef) throw new Error("Stripe dispute is missing its charge reference.");
  const charge = typeof chargeRef === "string" ? await stripe.charges.retrieve(chargeRef) : chargeRef;
  return { charge, dispute };
}

function affectedChargeCents(charge: Stripe.Charge, dispute: Stripe.Dispute | null) {
  if (dispute) return Math.max(0, Number(dispute.amount || 0));
  return Math.max(0, Number(charge.amount_refunded || 0));
}

async function reconcileWalletOrTip(
  db: any,
  event: Stripe.Event,
  charge: Stripe.Charge,
  dispute: Stripe.Dispute | null,
) {
  const paymentIntentId = paymentIntentIdFromCharge(charge);
  if (!paymentIntentId) return false;
  const affected = affectedChargeCents(charge, dispute);
  if (affected <= 0) return false;

  const walletTx = await db.from("customer_wallet_transactions")
    .select("id,customer_id,amount_cents")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("transaction_type", "topup")
    .maybeSingle();
  requireDatabaseSuccess(walletTx.error, "Find refunded wallet top-up");
  if (walletTx.data?.id) {
    const reversals = await db.from("customer_wallet_transactions")
      .select("amount_cents")
      .eq("reversal_of_transaction_id", walletTx.data.id);
    requireDatabaseSuccess(reversals.error, "Read wallet reversals");
    const alreadyReversed = (reversals.data || []).reduce(
      (sum: number, row: any) => sum + Math.abs(Number(row.amount_cents || 0)),
      0,
    );
    const target = Math.min(Math.abs(Number(walletTx.data.amount_cents || 0)), affected);
    const delta = Math.max(0, target - alreadyReversed);
    if (delta > 0) {
      const reversal = await db.rpc("reverse_customer_wallet_topup", {
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_event_id: event.id,
        p_amount_cents: delta,
        p_reason: dispute ? `Stripe dispute ${dispute.id}` : `Stripe refund on charge ${charge.id}`,
      });
      requireDatabaseSuccess(reversal.error, "Reverse wallet top-up");
    }
    return true;
  }

  const tipResult = await db.from("customer_tips")
    .select("id,amount_cents,refunded_amount_cents,status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  requireDatabaseSuccess(tipResult.error, "Find refunded customer tip");
  if (!tipResult.data?.id) return false;

  const tipAmount = Number(tipResult.data.amount_cents || 0);
  const target = Math.min(tipAmount, affected);
  const status = dispute ? "disputed" : target >= tipAmount ? "refunded" : "paid";
  const tipUpdate = await db.from("customer_tips").update({
    refunded_amount_cents: Math.max(Number(tipResult.data.refunded_amount_cents || 0), target),
    status,
    last_stripe_event_id: event.id,
  }).eq("id", tipResult.data.id);
  requireDatabaseSuccess(tipUpdate.error, "Reconcile Stripe customer tip");
  return true;
}

async function reversePayoutForPayment(
  db: any,
  stripe: Stripe,
  event: Stripe.Event,
  charge: Stripe.Charge,
  dispute: Stripe.Dispute | null,
  payment: any,
) {
  const payoutResult = await db.from("company_payout_items")
    .select("id,transfer_amount,status,stripe_transfer_id,reversed_transfer_amount,stripe_transfer_reversal_ids,invoice_id")
    .eq("payment_id", payment.id)
    .maybeSingle();
  requireDatabaseSuccess(payoutResult.error, "Find refunded or disputed payout");
  const payout = payoutResult.data;
  if (!payout) return;

  const chargeAmount = Math.max(1, Number(charge.amount || 0));
  const affected = Math.min(chargeAmount, affectedChargeCents(charge, dispute));
  const transferCents = Math.max(0, Math.round(Number(payout.transfer_amount || 0) * 100));
  const targetCents = Math.min(transferCents, Math.round(transferCents * affected / chargeAmount));
  const alreadyCents = Math.max(0, Math.round(Number(payout.reversed_transfer_amount || 0) * 100));
  const deltaCents = Math.max(0, targetCents - alreadyCents);
  let reversalId = "";

  if (payout.stripe_transfer_id && deltaCents > 0) {
    const reversal = await stripe.transfers.createReversal(
      payout.stripe_transfer_id,
      {
        amount: deltaCents,
        metadata: {
          payoutItemId: payout.id,
          paymentId: payment.id,
          stripeEventId: event.id,
          reason: dispute ? "dispute" : "refund",
        },
      },
      { idempotencyKey: `payout-reversal-${payout.id}-${event.id}` },
    );
    reversalId = reversal.id;
  }

  const reversalIds = Array.isArray(payout.stripe_transfer_reversal_ids)
    ? payout.stripe_transfer_reversal_ids.map(String)
    : [];
  if (reversalId && !reversalIds.includes(reversalId)) reversalIds.push(reversalId);

  const status = dispute ? "disputed" : "refunded";
  const reason = dispute
    ? `Stripe dispute ${dispute.id}; ${targetCents} cents of company transfer exposure.`
    : `Stripe refund; ${targetCents} cents of company transfer exposure.`;
  const payoutUpdate = await db.from("company_payout_items").update({
    status,
    hold_reason: reason,
    reversed_transfer_amount: (alreadyCents + (reversalId ? deltaCents : 0)) / 100,
    stripe_transfer_reversal_ids: reversalIds,
    last_reversal_at: reversalId ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", payout.id);
  requireDatabaseSuccess(payoutUpdate.error, "Reconcile refunded or disputed payout");

  if (!dispute && charge.refunded) {
    const paymentUpdate = await db.from("payments").update({ status: "refunded" }).eq("id", payment.id);
    requireDatabaseSuccess(paymentUpdate.error, "Update refunded payment");
    if (payout.invoice_id) {
      const invoiceUpdate = await db.from("invoices").update({ status: "refunded" }).eq("id", payout.invoice_id);
      requireDatabaseSuccess(invoiceUpdate.error, "Update refunded invoice");
    }
  }
}

async function handleRefundOrDispute(db: any, stripe: Stripe, event: Stripe.Event) {
  const { charge, dispute } = await chargeFromFinancialEvent(stripe, event);
  const handledAuxiliaryPayment = await reconcileWalletOrTip(db, event, charge, dispute);
  if (handledAuxiliaryPayment) return;

  const payment = await db.from("payments")
    .select("id,invoice_id,stripe_charge_id")
    .eq("stripe_charge_id", charge.id)
    .maybeSingle();
  requireDatabaseSuccess(payment.error, "Find refunded or disputed payment");
  if (!payment.data?.id) throw new Error("Stripe charge is not linked to a known payment, wallet top-up or tip.");

  await reversePayoutForPayment(db, stripe, event, charge, dispute, payment.data);
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
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
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
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;

  try {
    const shouldProcess = await claimEvent(db, event);
    if (!shouldProcess) return NextResponse.json({ received: true, duplicate: true });

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata?.paymentKind === "customer_tip") {
          await markCustomerTipPaid(db, intent);
        } else if (intent.metadata?.paymentKind === "wallet_topup") {
          await markWalletTopupPaid(db, intent);
        } else {
          await markInvoicePaid(db, intent);
        }
        break;
      }
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
        await handleRefundOrDispute(db, stripe, event);
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
