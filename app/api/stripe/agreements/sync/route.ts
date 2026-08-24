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
    if (!url || !serviceKey || !stripeKey) return failure("Stripe agreement sync is not configured.", 503);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before syncing a contract.", 401);

    const body = (await request.json()) as { agreementId?: string };
    const agreementId = String(body.agreementId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(agreementId)) return failure("Choose a valid agreement.", 400);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const [{ data: profile }, { data: agreement, error: agreementError }] = await Promise.all([
      db.from("profiles").select("id,role,active,organization_id,company_id").eq("id", auth.user.id).maybeSingle(),
      db.from("billing_agreements")
        .select("id,company_id,customer_id,job_id,contract_owner_role,billing_model,collection_timing,customer_amount_cents,provider_payout_cents,platform_fee_basis_points,prepaid_plan_type,plan_billing_day,service_frequency,stripe_product_id,stripe_price_id")
        .eq("id", agreementId)
        .maybeSingle(),
    ]);

    if (agreementError || !agreement) return failure("Agreement not found.", 404);
    if (!profile?.active || !["master", "admin", "manager"].includes(String(profile.role))) return failure("You cannot sync this agreement.", 403);

    const profileCompanyId = profile.company_id || profile.organization_id;
    const maySync = agreement.contract_owner_role === "master"
      ? profile.role === "master"
      : ["admin", "manager"].includes(String(profile.role)) && profileCompanyId === agreement.company_id;
    if (!maySync) return failure("You cannot sync this agreement.", 403);

    if (agreement.collection_timing === "manual" || agreement.billing_model === "manual") {
      return failure("Manual agreements do not create automatic Stripe Products or Prices.", 409);
    }

    const monthly = agreement.collection_timing === "period_prepaid"
      && agreement.service_frequency === "monthly"
      && agreement.billing_model === "monthly_fixed_subscription";
    const perVisit = agreement.collection_timing === "after_visit"
      && ["one_time", "weekly", "biweekly", "custom"].includes(String(agreement.service_frequency))
      && ["per_visit_fixed_payout", "per_visit_percentage_fee"].includes(String(agreement.billing_model));

    if (!monthly && !perVisit) {
      return failure("Weekly and biweekly services use protected per-Visit billing; monthly service uses one monthly period charge.", 409);
    }
    if (monthly && agreement.prepaid_plan_type && agreement.prepaid_plan_type !== "monthly") {
      return failure("Monthly customer collection must use the monthly plan type.", 409);
    }

    const [{ data: customer }, { data: job }] = await Promise.all([
      db.from("customers").select("full_name,email").eq("id", agreement.customer_id).maybeSingle(),
      db.from("jobs").select("service_name").eq("id", agreement.job_id).maybeSingle(),
    ]);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const productName = `${job?.service_name || "Service plan"} · ${customer?.full_name || "Customer"}`;
    const metadata = {
      agreementId: agreement.id,
      customerId: agreement.customer_id,
      companyId: agreement.company_id,
      ownerRole: agreement.contract_owner_role,
      providerPayoutCents: String(agreement.provider_payout_cents || 0),
      platformFeeBasisPoints: String(agreement.platform_fee_basis_points || 0),
      collectionTiming: monthly ? "monthly" : "per_visit_after_service",
      serviceFrequency: String(agreement.service_frequency || "one_time"),
      billingDay: String(agreement.plan_billing_day || 1),
    };

    const product = agreement.stripe_product_id
      ? await stripe.products.update(agreement.stripe_product_id, { name: productName, metadata })
      : await stripe.products.create({ name: productName, metadata }, { idempotencyKey: `agreement-product-${agreement.id}` });

    const amount = Number(agreement.customer_amount_cents || 0);
    if (!Number.isSafeInteger(amount) || amount < 50) return failure("Agreement amount must be at least $0.50 CAD.", 409);

    let priceId = agreement.stripe_price_id as string | null;
    if (priceId) {
      try {
        const existing = await stripe.prices.retrieve(priceId);
        const compatible = existing.active
          && existing.currency === "cad"
          && existing.unit_amount === amount
          && (monthly ? existing.recurring?.interval === "month" : !existing.recurring);
        if (!compatible) priceId = null;
      } catch {
        priceId = null;
      }
    }

    if (!priceId) {
      const price = await stripe.prices.create({
        currency: "cad",
        unit_amount: amount,
        product: product.id,
        ...(monthly ? { recurring: { interval: "month" as const } } : {}),
        metadata,
      }, { idempotencyKey: `agreement-price-${agreement.id}-${amount}-${monthly ? "monthly" : "per-visit"}` });
      priceId = price.id;
    }

    const update = await db.from("billing_agreements").update({
      stripe_product_id: product.id,
      stripe_price_id: priceId,
      stripe_sync_status: "synced",
      stripe_sync_error: null,
      stripe_synced_at: new Date().toISOString(),
    }).eq("id", agreement.id);
    if (update.error) throw new Error(update.error.message);

    return NextResponse.json({
      synced: true,
      billingCadence: monthly ? "monthly" : agreement.service_frequency === "one_time" ? "one_time" : "per_visit",
      productId: product.id,
      priceId,
    });
  } catch (error) {
    console.error("Stripe agreement sync failed", error);
    return failure(error instanceof Error ? error.message : "Could not sync agreement with Stripe.", 500);
  }
}
