import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { stripeReturnOrigin } from "@/lib/stripe/checkoutOrigin";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function configured() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stripeKey: process.env.STRIPE_SECRET_KEY,
  };
}

async function authenticatedCustomer(request: NextRequest, url: string, serviceKey: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: failure("Sign in before using your account balance.", 401) };

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return { error: failure("Your session expired. Sign in again.", 401) };

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

  if (!customer) return { error: failure("Customer account is not linked yet.", 403) };
  return { db, auth: auth.user, customer, companyId: customer.company_id || customer.organization_id || null };
}

export async function GET(request: NextRequest) {
  const { url, serviceKey } = configured();
  if (!url || !serviceKey) return failure("Account balance is not available yet.", 503);
  const context = await authenticatedCustomer(request, url, serviceKey);
  if ("error" in context) return context.error;

  const { data: wallet, error: walletError } = await context.db.from("customer_wallets").select("balance_cents,updated_at").eq("customer_id", context.customer.id).maybeSingle();
  if (walletError) return failure("Could not load account balance. Run the wallet migration first.", 500);

  const { data: transactions, error: transactionError } = await context.db.from("customer_wallet_transactions").select("id,transaction_type,amount_cents,balance_after_cents,description,created_at").eq("customer_id", context.customer.id).order("created_at", { ascending: false }).limit(20);
  if (transactionError) return failure("Could not load account history.", 500);

  return NextResponse.json({
    balanceCredits: Number(wallet?.balance_cents || 0) / 100,
    updatedAt: wallet?.updated_at || null,
    transactions: (transactions || []).map((item: any) => ({
      id: item.id,
      type: item.transaction_type,
      credits: Number(item.amount_cents || 0) / 100,
      balanceAfterCredits: Number(item.balance_after_cents || 0) / 100,
      description: item.description,
      createdAt: item.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const { url, serviceKey, stripeKey } = configured();
    if (!url || !serviceKey || !stripeKey) return failure("Account deposit checkout is not configured yet.", 503);
    const context = await authenticatedCustomer(request, url, serviceKey);
    if ("error" in context) return context.error;

    const body = (await request.json()) as { credits?: number; returnPath?: string };
    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits < 5 || credits > 1000) return failure("Choose a whole CAD amount between 5 and 1,000.", 400);

    const returnPath = body.returnPath === "/customer/payments" ? "/customer/payments" : "/mobile/customer/payments";
    const amountCents = credits * 100;
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const metadata = {
      paymentKind: "wallet_topup",
      companyId: context.companyId || "",
      customerId: context.customer.id,
      profileId: context.auth.id,
      credits: String(credits),
      amountCents: String(amountCents),
    };
    const origin = stripeReturnOrigin(request);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: context.customer.email || context.auth.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: amountCents, product_data: { name: "4Ever Seasons account credit", description: `CAD ${credits.toFixed(2)} in account credit for services or optional tips.` } } }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}${returnPath}?wallet_topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}?wallet_topup=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe account deposit checkout failed", error);
    return failure(error instanceof Error ? error.message : "Could not start account deposit checkout.", 500);
  }
}
