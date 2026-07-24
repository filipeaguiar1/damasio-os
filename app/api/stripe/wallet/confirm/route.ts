import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!url || !serviceKey || !stripeKey) {
      return failure("Wallet confirmation is not configured yet.", 503);
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before confirming wallet credits.", 401);

    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const body = (await request.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId.startsWith("cs_")) return failure("Stripe session is invalid.", 400);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"]
    });
    if (session.payment_status !== "paid") return failure("Stripe payment is not confirmed yet.", 409);
    if (session.metadata?.paymentKind !== "wallet_topup") {
      return failure("Stripe session is not a wallet top-up.", 400);
    }

    const companyId = String(session.metadata.companyId || "");
    const customerId = String(session.metadata.customerId || "");
    const profileId = String(session.metadata.profileId || "");
    const amountCents = Number(session.metadata.amountCents || session.amount_total || 0);
    if (!companyId || !customerId || profileId !== auth.user.id) {
      return failure("Wallet top-up does not belong to this customer.", 403);
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 100 || session.amount_total !== amountCents) {
      return failure("Wallet top-up amount is invalid.", 400);
    }

    const paymentIntent = typeof session.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(session.payment_intent)
      : session.payment_intent;
    if (!paymentIntent || paymentIntent.status !== "succeeded") {
      return failure("Stripe payment intent is not complete.", 409);
    }
    if (paymentIntent.metadata.paymentKind !== "wallet_topup"
      || paymentIntent.metadata.companyId !== companyId
      || paymentIntent.metadata.customerId !== customerId
      || paymentIntent.metadata.profileId !== auth.user.id
      || Number(paymentIntent.amount_received) !== amountCents) {
      return failure("Stripe payment metadata does not match the wallet top-up.", 400);
    }

    const { data, error } = await db.rpc("credit_customer_wallet", {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_amount_cents: amountCents,
      p_stripe_payment_intent_id: paymentIntent.id,
      p_description: `${amountCents / 100} wallet credits purchased with Stripe`
    });
    if (error) throw new Error(error.message);

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      confirmed: true,
      credited: Boolean(result?.credited),
      balanceCredits: Number(result?.balance_cents || 0) / 100
    });
  } catch (error) {
    console.error("Stripe wallet confirmation failed", error);
    return failure("Could not confirm wallet credits.", 500);
  }
}
