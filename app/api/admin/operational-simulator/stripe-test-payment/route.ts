import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational simulator is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || !["admin", "manager"].includes(String(profile.data.role))) {
    throw new Error("Only an active company Admin can run Stripe QA.");
  }

  const companyId = String(profile.data.company_id || profile.data.organization_id || "");
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

function depositInvoiceNumber(paymentIntentId: string) {
  const suffix = paymentIntentId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase();
  return `DEP-QA-${suffix}`;
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "";
    if (!stripeKey.startsWith("sk_test_")) {
      return failure("Stripe QA refused to run because STRIPE_SECRET_KEY is not a test key.", 409);
    }
    if (!webhookSecret) return failure("Stripe QA requires a webhook signing secret.", 503);
    if (process.env.VERCEL_ENV === "production") return failure("Stripe QA cannot run in production.", 403);

    const { service, companyId } = await requireAdmin(request);
    const body = await request.json() as { invoiceId?: string };
    const invoiceId = String(body.invoiceId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) return failure("Choose a valid Stripe QA invoice.", 400);

    const invoiceResult = await service.from("invoices")
      .select("id,company_id,organization_id,customer_id,total,status,invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceResult.error || !invoiceResult.data) throw new Error(invoiceResult.error?.message || "Stripe QA invoice was not found.");
    const invoice = invoiceResult.data;
    const invoiceCompanyId = String(invoice.company_id || invoice.organization_id || "");
    if (invoiceCompanyId !== companyId || !String(invoice.invoice_number || "").startsWith("SIM-STRIPE-")) {
      return failure("This invoice is not an isolated Stripe QA invoice for this company.", 403);
    }
    if (!invoice.customer_id) throw new Error("Stripe QA invoice has no Customer.");

    const customerResult = await service.from("customers")
      .select("id,profile_id,email,full_name")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    if (customerResult.error || !customerResult.data?.profile_id) throw new Error(customerResult.error?.message || "Stripe QA Customer login is missing.");
    const customer = customerResult.data;

    const amountCents = Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) throw new Error("Stripe QA invoice amount is invalid.");

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const invoiceMetadata = {
      invoiceId: invoice.id,
      companyId,
      customerId: customer.id,
      qaMode: "production_like_test",
    };
    const transferGroup = `invoice-${invoice.id}`;
    const invoiceIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      metadata: invoiceMetadata,
      transfer_group: transferGroup,
      description: `4Ever Seasons Stripe QA invoice ${invoice.invoice_number}`,
    }, { idempotencyKey: `qa-invoice-${invoice.id}-${amountCents}` });
    if (invoiceIntent.status !== "succeeded") throw new Error(`Stripe QA invoice PaymentIntent ended as ${invoiceIntent.status}.`);

    const eventId = `evt_qa_${randomUUID().replaceAll("-", "")}`;
    const eventPayload = JSON.stringify({
      id: eventId,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000),
      data: { object: invoiceIntent },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: "payment_intent.succeeded",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: webhookSecret });
    const webhookResponse = await fetch(`${request.nextUrl.origin}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: eventPayload,
    });
    const webhookBody = await webhookResponse.json().catch(() => ({}));
    if (!webhookResponse.ok) throw new Error(`Canonical Stripe webhook failed: ${webhookBody.error || webhookResponse.status}.`);

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
        qaMode: "production_like_test",
      },
      description: "4Ever Seasons Stripe QA account deposit",
    }, { idempotencyKey: `qa-wallet-${customer.id}-${invoice.id}` });
    if (walletIntent.status !== "succeeded" || Number(walletIntent.amount_received) !== walletAmountCents) {
      throw new Error(`Stripe QA wallet PaymentIntent ended as ${walletIntent.status}.`);
    }

    const walletCredit = await service.rpc("credit_customer_wallet", {
      p_company_id: companyId,
      p_customer_id: customer.id,
      p_amount_cents: walletAmountCents,
      p_stripe_payment_intent_id: walletIntent.id,
      p_description: "10.00 CAD account deposit paid with Stripe test card",
    });
    if (walletCredit.error) throw new Error(`Wallet credit failed: ${walletCredit.error.message}`);

    const walletTransaction = await service.from("customer_wallet_transactions")
      .select("id,balance_after_cents")
      .eq("customer_id", customer.id)
      .eq("stripe_payment_intent_id", walletIntent.id)
      .maybeSingle();
    if (walletTransaction.error || !walletTransaction.data?.id) throw new Error(walletTransaction.error?.message || "Wallet transaction was not created.");

    const depositInvoice = await service.from("customer_deposit_invoices")
      .upsert({
        customer_id: customer.id,
        company_id: companyId,
        wallet_transaction_id: walletTransaction.data.id,
        invoice_number: depositInvoiceNumber(walletIntent.id),
        status: "paid",
        amount_cents: walletAmountCents,
        stripe_payment_intent_id: walletIntent.id,
      }, { onConflict: "stripe_payment_intent_id" })
      .select("id,invoice_number")
      .single();
    if (depositInvoice.error) throw new Error(`Deposit invoice failed: ${depositInvoice.error.message}`);

    const [paidInvoice, payment, payout] = await Promise.all([
      service.from("invoices").select("id,status,stripe_payment_intent_id").eq("id", invoice.id).maybeSingle(),
      service.from("payments").select("id,status,amount").eq("stripe_payment_intent_id", invoiceIntent.id).maybeSingle(),
      service.from("company_payout_items").select("id,status,amount_total").eq("stripe_transfer_group", transferGroup).maybeSingle(),
    ]);
    if (paidInvoice.error || payment.error || payout.error) throw new Error(paidInvoice.error?.message || payment.error?.message || payout.error?.message);
    if (paidInvoice.data?.status !== "paid" || payment.data?.status !== "paid") throw new Error("Canonical invoice/payment records were not finalized.");

    const walletResult = Array.isArray(walletCredit.data) ? walletCredit.data[0] : walletCredit.data;
    return NextResponse.json({
      passed: true,
      stripeMode: "test",
      testCard: "pm_card_visa",
      invoice: paidInvoice.data,
      payment: payment.data,
      payout: payout.data,
      wallet: {
        paymentIntentId: walletIntent.id,
        balanceCredits: Number(walletResult?.balance_cents || walletTransaction.data.balance_after_cents || 0) / 100,
        depositInvoice: depositInvoice.data,
      },
      webhook: { received: Boolean(webhookBody.received), eventId },
    });
  } catch (error) {
    console.error("stripe-production-like-qa", error);
    return failure(error instanceof Error ? error.message : "Stripe production-like QA failed.", 500);
  }
}
