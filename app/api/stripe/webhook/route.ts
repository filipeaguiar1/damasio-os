import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function platformFee(total: number) {
  const percent = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || "0");
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(total * percent) / 100;
}

async function markInvoicePaid(db: any, paymentIntent: Stripe.PaymentIntent) {
  const invoiceId = String(paymentIntent.metadata.invoiceId || "");
  const companyId = String(paymentIntent.metadata.companyId || "");
  const customerId = String(paymentIntent.metadata.customerId || "");
  if (!invoiceId || !companyId) return;

  const { data: invoice } = await db
    .from("invoices")
    .select("id,organization_id,company_id,customer_id,property_id,quote_id,invoice_number,total")
    .eq("id", invoiceId)
    .maybeSingle() as { data: any };
  if (!invoice) return;

  const amountTotal = Number(invoice.total || 0);
  const fee = platformFee(amountTotal);
  const transferAmount = Math.max(0, Math.round((amountTotal - fee) * 100) / 100);
  const transferGroup = paymentIntent.transfer_group || `invoice-${invoice.id}`;
  const chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || null;

  const invoiceStripeUpdate = await db.from("invoices").update({
    status: "paid",
    stripe_payment_intent_id: paymentIntent.id,
    stripe_charge_id: chargeId,
    stripe_transfer_group: transferGroup,
    stripe_platform_fee: fee,
    stripe_transfer_amount: transferAmount
  }).eq("id", invoice.id);
  if (invoiceStripeUpdate.error) {
    await db.from("invoices").update({ status: "paid" }).eq("id", invoice.id);
  }

  const { data: existingPayment } = await db
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .maybeSingle() as { data: any };

  let paymentId = existingPayment?.id;
  if (!paymentId) {
    const paymentPayload = {
      organization_id: invoice.company_id || invoice.organization_id,
      company_id: invoice.company_id || invoice.organization_id,
      invoice_id: invoice.id,
      customer_id: invoice.customer_id || customerId || null,
      method: "credit_card",
      status: "paid",
      amount: amountTotal,
      reference: paymentIntent.id,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: chargeId,
      stripe_transfer_group: transferGroup,
      paid_at: new Date().toISOString(),
      notes: "Stripe Checkout payment confirmed by webhook."
    };
    let paymentInsert = await db.from("payments").insert(paymentPayload).select("id").single() as { data: any; error?: { message?: string } };
    if (paymentInsert.error) {
      const { company_id: _companyId, stripe_payment_intent_id: _intent, stripe_charge_id: _charge, stripe_transfer_group: _group, ...legacyPayload } = paymentPayload;
      paymentInsert = await db.from("payments").insert(legacyPayload).select("id").single() as { data: any };
    }
    const payment = paymentInsert.data;
    paymentId = payment?.id;
  }

  const payoutLookup = await db.from("company_payout_items").select("id").eq("payment_id", paymentId).maybeSingle() as { data: any; error?: { message?: string } };
  const existingPayout = payoutLookup.error ? null : payoutLookup.data;

  if (paymentId && !existingPayout) {
    const { data: job } = await db
      .from("jobs")
      .select("id")
      .eq("invoice_id", invoice.id)
      .maybeSingle() as { data: any };

    const { data: visit } = job?.id
      ? await db.from("visits").select("id").eq("job_id", job.id).order("scheduled_date", { ascending: false }).limit(1).maybeSingle() as { data: any }
      : { data: null };

    await db.from("company_payout_items").insert({
      company_id: invoice.company_id || invoice.organization_id,
      invoice_id: invoice.id,
      payment_id: paymentId,
      job_id: job?.id || null,
      visit_id: visit?.id || null,
      customer_id: invoice.customer_id || customerId || null,
      property_id: invoice.property_id || null,
      amount_total: amountTotal,
      platform_fee: fee,
      transfer_amount: transferAmount,
      status: visit?.id ? "pending_feedback" : "eligible",
      hold_reason: visit?.id ? "Waiting for service feedback or 3 days without open tasks." : null,
      eligible_at: visit?.id ? null : new Date().toISOString(),
      stripe_transfer_group: transferGroup
    });
  }

  await db.from("activity_log").insert({
    organization_id: invoice.company_id || invoice.organization_id,
    company_id: invoice.company_id || invoice.organization_id,
    action: "stripe.payment_confirmed",
    entity_type: "invoice",
    entity_id: invoice.id,
    details: `Stripe payment ${paymentIntent.id} confirmed. Weekly payout item prepared.`
  });
}

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !webhookSecret || !url || !serviceKey) return bad("Stripe webhook is not configured.", 503);

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return bad("Missing Stripe signature.");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch (error) {
    console.error("Invalid Stripe webhook signature", error);
    return bad("Invalid Stripe signature.");
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

  try {
    if (event.type === "payment_intent.succeeded") {
      await markInvoicePaid(db, event.data.object as Stripe.PaymentIntent);
    }
    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const invoiceId = String(intent.metadata.invoiceId || "");
      if (invoiceId) {
        await db.from("invoices").update({ status: "waiting_payment", stripe_payment_intent_id: intent.id }).eq("id", invoiceId);
        const failedPaymentPayload = {
          organization_id: intent.metadata.companyId,
          company_id: intent.metadata.companyId,
          invoice_id: invoiceId,
          customer_id: intent.metadata.customerId || null,
          method: "credit_card",
          status: "failed",
          amount: Math.round((intent.amount || 0)) / 100,
          reference: intent.id,
          stripe_payment_intent_id: intent.id,
          failure_code: intent.last_payment_error?.code || null,
          failure_message: intent.last_payment_error?.message || null
        };
        const failedInsert = await db.from("payments").insert(failedPaymentPayload);
        if (failedInsert.error) {
          const { company_id: _companyId, stripe_payment_intent_id: _intent, ...legacyFailedPaymentPayload } = failedPaymentPayload;
          await db.from("payments").insert(legacyFailedPaymentPayload);
        }
      }
    }
    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const charge = event.data.object as Stripe.Charge;
      await db.from("company_payout_items").update({
        status: event.type === "charge.refunded" ? "refunded" : "disputed",
        hold_reason: event.type === "charge.refunded" ? "Stripe charge refunded." : "Stripe dispute opened.",
        updated_at: new Date().toISOString()
      }).eq("stripe_transfer_group", charge.transfer_group);
    }
  } catch (error) {
    console.error("Stripe webhook handler failed", event.type, error);
    return bad("Webhook handler failed.", 500);
  }

  return NextResponse.json({ received: true });
}
