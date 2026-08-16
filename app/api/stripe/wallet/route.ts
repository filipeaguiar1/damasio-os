import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";
import { stripeReturnOrigin } from "@/lib/stripe/checkoutOrigin";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { service: db, customer, identity } = await requireCustomerPortalIdentity(request);
    if (!customer) return failure("Customer account is not linked yet.", 403);

    const { data: wallet, error: walletError } = await db
      .from("customer_wallets")
      .select("balance_cents,updated_at")
      .eq("customer_id", identity.customerId)
      .maybeSingle();
    if (walletError) return failure("Could not load account balance. Run the wallet migration first.", 500);

    const { data: transactions, error: transactionError } = await db
      .from("customer_wallet_transactions")
      .select("id,transaction_type,amount_cents,balance_after_cents,description,created_at")
      .eq("customer_id", identity.customerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (transactionError) return failure("Could not load account history.", 500);

    return NextResponse.json({
      balanceCredits: Number(wallet?.balance_cents || 0) / 100,
      updatedAt: wallet?.updated_at || null,
      customerId: customer.id,
      transactions: (transactions || []).map((item: any) => ({
        id: item.id,
        type: item.transaction_type,
        credits: Number(item.amount_cents || 0) / 100,
        balanceAfterCredits: Number(item.balance_after_cents || 0) / 100,
        description: item.description,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account balance could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return failure("Account deposit checkout is not configured yet.", 503);

    const { user, customer, identity } = await requireCustomerPortalIdentity(request);
    if (!customer) return failure("Customer account is not linked yet.", 403);

    const body = (await request.json()) as { credits?: number; returnPath?: string };
    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits < 5 || credits > 1000) {
      return failure("Choose a whole CAD amount between 5 and 1,000.", 400);
    }

    const returnPath = body.returnPath === "/customer/payments" ? "/customer/payments" : "/mobile/customer/payments";
    const amountCents = credits * 100;
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const metadata = {
      paymentKind: "wallet_topup",
      companyId: identity.companyId || "",
      customerId: identity.customerId,
      profileId: identity.profileId,
      credits: String(credits),
      amountCents: String(amountCents),
    };
    const origin = stripeReturnOrigin(request);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email || user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: amountCents,
          product_data: {
            name: "4Ever Seasons account credit",
            description: `CAD ${credits.toFixed(2)} in account credit for services or optional tips.`,
          },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}${returnPath}?wallet_topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}?wallet_topup=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe account deposit checkout failed", error);
    const message = error instanceof Error ? error.message : "Could not start account deposit checkout.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}