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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!url || !serviceKey || !stripeKey || !siteUrl) return failure("Tip checkout is not configured yet.", 503);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before sending a tip.", 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    let customer = null;
    const byProfile = await db.from("customers").select("id,company_id,organization_id,email,full_name,archived_at").eq("profile_id", auth.user.id).is("archived_at", null).maybeSingle();
    if (!byProfile.error) customer = byProfile.data;
    if (!customer && auth.user.user_metadata?.customer_id) {
      const byMetadata = await db.from("customers").select("id,company_id,organization_id,email,full_name,archived_at").eq("id", auth.user.user_metadata.customer_id).is("archived_at", null).maybeSingle();
      if (!byMetadata.error) customer = byMetadata.data;
    }
    if (!customer && auth.user.email) {
      const byEmail = await db.from("customers").select("id,company_id,organization_id,email,full_name,archived_at").ilike("email", auth.user.email.trim()).is("archived_at", null).limit(1).maybeSingle();
      if (!byEmail.error) customer = byEmail.data;
    }
    if (!customer) return failure("Customer account is not linked yet.", 403);

    const body = (await request.json()) as { amount?: number; returnPath?: string; note?: string };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) return failure("Choose a tip between $1 and $500.", 400);
    const amountCents = Math.round(amount * 100);
    const companyId = customer.company_id || customer.organization_id || "";
    const returnPath = body.returnPath === "/customer/payments" ? "/customer/payments" : "/mobile/customer/payments";
    const metadata = {
      paymentKind: "customer_tip",
      customerId: customer.id,
      companyId,
      profileId: auth.user.id,
      amountCents: String(amountCents),
      note: String(body.note || "").slice(0, 200),
    };

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email || auth.user.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: amountCents, product_data: { name: "Service tip", description: "Optional tip submitted through 4Ever Seasons." } } }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${siteUrl}${returnPath}?tip=success&tip_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${returnPath}?tip=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe tip checkout failed", error);
    return failure(error instanceof Error ? error.message : "Could not start tip checkout.", 500);
  }
}
