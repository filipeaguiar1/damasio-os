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
    if (!url || !serviceKey || !stripeKey) return failure("Tip confirmation is not configured yet.", 503);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before confirming a tip.", 401);
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const body = (await request.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId || "");
    if (!sessionId.startsWith("cs_")) return failure("Stripe session is invalid.", 400);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid" || session.metadata?.paymentKind !== "customer_tip") return failure("Tip payment is not confirmed.", 409);

    const customerId = String(session.metadata.customerId || "");
    const profileId = String(session.metadata.profileId || "");
    const companyId = String(session.metadata.companyId || "") || null;
    const amountCents = Number(session.metadata.amountCents || session.amount_total || 0);
    if (!customerId || profileId !== auth.user.id || !Number.isSafeInteger(amountCents) || amountCents < 100 || session.amount_total !== amountCents) return failure("Tip payment does not match this customer.", 403);

    const ownership = await db.from("customers").select("id,profile_id,email").eq("id", customerId).maybeSingle();
    if (ownership.error || !ownership.data || (ownership.data.profile_id !== auth.user.id && String(ownership.data.email || "").toLowerCase() !== String(auth.user.email || "").toLowerCase())) return failure("Tip customer could not be verified.", 403);

    const intent = typeof session.payment_intent === "string" ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
    if (!intent || intent.status !== "succeeded" || intent.metadata.paymentKind !== "customer_tip" || intent.metadata.customerId !== customerId || intent.metadata.profileId !== auth.user.id || Number(intent.amount_received) !== amountCents) return failure("Stripe tip metadata is invalid.", 400);

    const { error } = await db.from("customer_tips").upsert({
      customer_id: customerId,
      company_id: companyId,
      amount_cents: amountCents,
      stripe_payment_intent_id: intent.id,
      status: "paid",
      note: session.metadata.note || null,
    }, { onConflict: "stripe_payment_intent_id" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ confirmed: true, amount: amountCents / 100, message: "Thank you. Your tip was confirmed." });
  } catch (error) {
    console.error("Stripe tip confirmation failed", error);
    return failure(error instanceof Error ? error.message : "Could not confirm the tip.", 500);
  }
}
