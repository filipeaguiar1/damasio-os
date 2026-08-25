import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!supabaseUrl || !serviceKey || !stripeKey) return fail("Payment confirmation is unavailable.", 503);

    const body = (await request.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId || "").trim();
    if (!/^cs_(live|test)_/.test(sessionId)) return fail("Invalid Checkout Session.", 400);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid") return NextResponse.json({ confirmed: false, status: session.payment_status });

    const paymentIntent = typeof session.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(session.payment_intent)
      : session.payment_intent as Stripe.PaymentIntent | null;
    if (!paymentIntent || paymentIntent.status !== "succeeded") return fail("Stripe payment is not completed yet.", 409);

    const invoiceId = String(session.metadata?.invoiceId || paymentIntent.metadata?.invoiceId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) return fail("Checkout Session has no canonical invoice.", 409);

    const chargeId = typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id || "";

    let stripeFeeCents = 0;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const balanceTransaction = typeof charge.balance_transaction === "string"
        ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
        : charge.balance_transaction;
      stripeFeeCents = Number(balanceTransaction?.fee || 0);
    }

    const amountCents = Number(session.amount_total || paymentIntent.amount_received || paymentIntent.amount || 0);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) return fail("Stripe paid amount is invalid.", 409);

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const confirmation = await db.rpc("confirm_stripe_paid_invoice", {
      p_invoice_id: invoiceId,
      p_payment_intent_id: paymentIntent.id,
      p_charge_id: chargeId || null,
      p_transfer_group: paymentIntent.transfer_group || `invoice-${invoiceId}`,
      p_amount_cents: amountCents,
    });
    if (confirmation.error) throw new Error(confirmation.error.message);

    const financials = await db.rpc("apply_stripe_processing_fee", {
      p_invoice_id: invoiceId,
      p_payment_intent_id: paymentIntent.id,
      p_charge_id: chargeId || null,
      p_fee_cents: stripeFeeCents,
    });
    if (financials.error) throw new Error(financials.error.message);

    return NextResponse.json({
      confirmed: true,
      invoiceId,
      paymentIntentId: paymentIntent.id,
      stripeFeeCents,
      financials: financials.data,
    });
  } catch (error) {
    console.error("Stripe Checkout return confirmation failed", error);
    return fail("Payment was accepted by Stripe, but reconciliation is still pending.", 500);
  }
}
