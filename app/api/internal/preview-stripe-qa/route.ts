import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { POST as processStripeWebhook } from "@/app/api/stripe/webhook/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QA_BRANCH = "feature/25-30-homes-simulator-v1";
const QA_SECRET_HEADER = "x-damasio-qa-secret";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function secretMatches(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function depositInvoiceNumber(paymentIntentId: string) {
  const suffix = paymentIntentId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase();
  return `DEP-${suffix}`;
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
    const commit = process.env.VERCEL_GIT_COMMIT_SHA || "local";
    const branch = process.env.VERCEL_GIT_COMMIT_REF || "";

    if (process.env.VERCEL_ENV !== "preview") return fail("Preview-only QA route.", 403);
    if (branch !== QA_BRANCH) return fail("Wrong preview branch.", 403);
    if (!secretMatches(request.headers.get(QA_SECRET_HEADER), bypassSecret)) return fail("Invalid QA authorization.", 403);

    const body = await request.json().catch(() => ({})) as { commit?: string };
    if (String(body.commit || "") !== commit) return fail("Preview commit does not match.", 409);
    if (!stripeKey.startsWith("sk_test_")) return fail("Stripe is not in test mode.", 409);
    if (!webhookSecret || !supabaseUrl || !serviceKey || !bypassSecret) {
      return fail("Stripe, Supabase, or automation-bypass QA configuration is incomplete.", 503);
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

    const customerResult = await db.from("customers")
      .select("id,profile_id,email,full_name,company_id,organization_id")
      .like("email", "ops-sim-%@4everseasons.test")
      .not("profile_id", "is", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (customerResult.error || !customerResult.data) {
      throw new Error(customerResult.error?.message || "No active simulation Customer was found.");
    }

    const customer = customerResult.data;
    const companyId = String(customer.company_id || customer.organization_id || "");
    if (!companyId) throw new Error("Simulation Customer has no company identity.");

    const [propertyResult, quoteResult] = await Promise.all([
      db.from("properties").select("id").eq("customer_id", customer.id).limit(1).maybeSingle(),
      db.from("quotes").select("id").eq("customer_id", customer.id).limit(1).maybeSingle(),
    ]);
    if (propertyResult.error || !propertyResult.data) {
      throw new Error(propertyResult.error?.message || "Simulation Property was not found.");
    }
    if (quoteResult.error || !quoteResult.data) {
      throw new Error(quoteResult.error?.message || "Simulation Quote was not found.");
    }

    const invoiceNumber = `SIM-STRIPE-${commit.slice(0, 8).toUpperCase()}`;
    let invoiceResult = await db.from("invoices")
      .select("id,invoice_number,status,total")
      .eq("customer_id", customer.id)
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);

    if (!invoiceResult.data) {
      const invoice = {
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        quote_id: quoteResult.data.id,
        customer_id: customer.id,
        property_id: propertyResult.data.id,
        invoice_number: invoiceNumber,
        status: "waiting_payment",
        subtotal: 40,
        tax: 5.2,
        total: 45.2,
        created_at: new Date().toISOString(),
      };
      let inserted = await db.from("invoices")
        .insert(invoice)
        .select("id,invoice_number,status,total")
        .single();
      if (inserted.error && /company_id|schema cache|does not exist/i.test(inserted.error.message)) {
        const { company_id: _companyId, ...legacy } = invoice;
        inserted = await db.from("invoices")
          .insert(legacy)
          .select("id,invoice_number,status,total")
          .single();
      }
      if (inserted.error) throw new Error(inserted.error.message);
      invoiceResult = inserted;
    }

    const invoice = invoiceResult.data;
    if (!invoice) throw new Error("Stripe QA invoice was not created.");

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const amountCents = Math.round(Number(invoice.total) * 100);
    const transferGroup = `invoice-${invoice.id}`;
    const metadata = {
      invoiceId: invoice.id,
      companyId,
      customerId: customer.id,
      qaMode: "protected_preview",
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      metadata,
      transfer_group: transferGroup,
      description: `4Ever Seasons protected preview QA ${invoiceNumber}`,
    }, { idempotencyKey: `preview-invoice-${commit}-${invoice.id}` });
    if (paymentIntent.status !== "succeeded") {
      throw new Error(`Invoice test payment ended as ${paymentIntent.status}.`);
    }

    const eventId = `evt_preview_qa_${commit.slice(0, 12)}`;
    const payload = JSON.stringify({
      id: eventId,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000),
      data: { object: paymentIntent },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: "payment_intent.succeeded",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const webhookResponse = await processStripeWebhook(new NextRequest(new URL("/api/stripe/webhook", request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    }));
    const webhookBody = await webhookResponse.json().catch(() => ({}));
    if (!webhookResponse.ok) {
      throw new Error(`Canonical webhook failed: ${webhookBody.error || webhookResponse.status}.`);
    }

    const walletAmountCents = 1000;
    const walletIntent = await stripe.paymentIntents.create({
      amount: walletAmountCents,
      currency: "cad",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      metadata: {
        paymentKind: "wallet_topup",
        companyId,
        customerId: customer.id,
        profileId: customer.profile_id,
        amountCents: String(walletAmountCents),
        qaMode: "protected_preview",
      },
      description: "4Ever Seasons protected preview account deposit QA",
    }, { idempotencyKey: `preview-wallet-${commit}-${customer.id}` });
    if (walletIntent.status !== "succeeded") {
      throw new Error(`Wallet test payment ended as ${walletIntent.status}.`);
    }

    const walletCredit = await db.rpc("credit_customer_wallet", {
      p_company_id: companyId,
      p_customer_id: customer.id,
      p_amount_cents: walletAmountCents,
      p_stripe_payment_intent_id: walletIntent.id,
      p_description: "10.00 CAD account deposit paid with Stripe protected preview test card",
    });
    if (walletCredit.error) throw new Error(`Wallet credit failed: ${walletCredit.error.message}`);

    const walletTransactionResult = await db.from("customer_wallet_transactions")
      .select("id,balance_after_cents,amount_cents,transaction_type")
      .eq("stripe_payment_intent_id", walletIntent.id)
      .maybeSingle();
    if (walletTransactionResult.error || !walletTransactionResult.data) {
      throw new Error(walletTransactionResult.error?.message || "Wallet transaction was not created.");
    }

    const depositInvoice = await db.from("customer_deposit_invoices")
      .upsert({
        customer_id: customer.id,
        company_id: companyId,
        wallet_transaction_id: walletTransactionResult.data.id,
        invoice_number: depositInvoiceNumber(walletIntent.id),
        status: "paid",
        amount_cents: walletAmountCents,
        stripe_payment_intent_id: walletIntent.id,
      }, { onConflict: "stripe_payment_intent_id" })
      .select("id,invoice_number,status,amount_cents")
      .single();
    if (depositInvoice.error) throw new Error(`Deposit invoice failed: ${depositInvoice.error.message}`);

    const [paidInvoice, payment, payout, webhookLedger] = await Promise.all([
      db.from("invoices")
        .select("id,status,stripe_payment_intent_id,stripe_transfer_group")
        .eq("id", invoice.id)
        .maybeSingle(),
      db.from("payments")
        .select("id,status,amount,stripe_payment_intent_id")
        .eq("stripe_payment_intent_id", paymentIntent.id)
        .maybeSingle(),
      db.from("company_payout_items")
        .select("id,status,amount_total,transfer_amount,stripe_transfer_group")
        .eq("stripe_transfer_group", transferGroup)
        .maybeSingle(),
      db.from("stripe_webhook_events")
        .select("event_id,status,attempts,processed_at")
        .eq("event_id", eventId)
        .maybeSingle(),
    ]);

    const queryError = paidInvoice.error || payment.error || payout.error || webhookLedger.error;
    if (queryError) throw new Error(queryError.message);
    if (paidInvoice.data?.status !== "paid") throw new Error("QA invoice was not marked paid.");
    if (payment.data?.status !== "paid") throw new Error("Canonical Payment was not marked paid.");
    if (!payout.data?.id) throw new Error("Canonical payout item was not created.");
    if (webhookLedger.data?.status !== "processed") throw new Error("Webhook ledger was not finalized.");

    return NextResponse.json({
      passed: true,
      commit,
      stripeMode: "test",
      invoice: paidInvoice.data,
      payment: payment.data,
      payout: payout.data,
      wallet: {
        paymentIntentId: walletIntent.id,
        transactionId: walletTransactionResult.data.id,
        transactionType: walletTransactionResult.data.transaction_type,
        amountCredits: Number(walletTransactionResult.data.amount_cents || 0) / 100,
        balanceCredits: Number(walletTransactionResult.data.balance_after_cents || 0) / 100,
        depositInvoice: depositInvoice.data,
      },
      webhook: {
        received: Boolean(webhookBody.received),
        duplicate: Boolean(webhookBody.duplicate),
        eventId,
        ledger: webhookLedger.data,
      },
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("protected-preview-stripe-qa", error);
    return fail(error instanceof Error ? error.message : "Protected preview Stripe QA failed.", 500);
  }
}
