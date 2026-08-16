import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!stripeKey || !siteUrl) return failure("Tip checkout is not configured yet.", 503);

    const { user, customer, identity } = await requireCustomerPortalIdentity(request);
    if (!customer) return failure("Customer account is not linked yet.", 403);

    const body = (await request.json()) as { amount?: number; returnPath?: string; note?: string };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) return failure("Choose a tip between $1 and $500.", 400);

    const amountCents = Math.round(amount * 100);
    const allowedPaths = new Set(["/customer/feedback", "/mobile/customer/feedback"]);
    const returnPath = allowedPaths.has(String(body.returnPath || "")) ? String(body.returnPath) : "/customer/feedback";
    const metadata = {
      paymentKind: "customer_tip",
      customerId: identity.customerId,
      companyId: identity.companyId || "",
      profileId: identity.profileId,
      amountCents: String(amountCents),
      note: String(body.note || "").slice(0, 200),
    };

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email || user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: amountCents,
          product_data: {
            name: "Service tip",
            description: "Optional tip submitted after customer feedback.",
          },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${siteUrl}${returnPath}?tip=success&tip_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${returnPath}?tip=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe tip checkout failed", error);
    const message = error instanceof Error ? error.message : "Could not start tip checkout.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}