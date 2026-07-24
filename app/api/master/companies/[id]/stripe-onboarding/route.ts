import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url || !anonKey || !serviceKey || !stripeKey || !siteUrl) throw new Error("Stripe Connect onboarding is not configured.");
  return { url, anonKey, serviceKey, stripeKey, siteUrl };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe onboarding failed." }, { status });
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const { url, anonKey, serviceKey } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await authClient.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only Master can start company Stripe onboarding.");
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  return { service };
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const companyId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(companyId)) throw new Error("Choose a valid company.");
    const { stripeKey, siteUrl } = env();
    const { service } = await requireMaster(request);
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });

    const { data: company, error: companyError } = await service
      .from("organizations")
      .select("id,name,contact_email,stripe_connected_account_id,stripe_connect_status")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError || !company) throw new Error(companyError?.message || "Company not found.");

    let accountId = company.stripe_connected_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        country: "CA",
        email: company.contact_email || undefined,
        business_type: "company",
        business_profile: {
          name: company.name,
          product_description: "Property maintenance services paid through Damasio OS.",
        },
        capabilities: { transfers: { requested: true } },
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
          requirement_collection: "stripe",
        },
        metadata: { companyId: company.id },
      } as Stripe.AccountCreateParams);
      accountId = account.id;
      await service.from("organizations").update({
        stripe_connected_account_id: accountId,
        stripe_connect_status: "onboarding",
      }).eq("id", company.id);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${siteUrl}/master?stripe=refresh&company=${company.id}`,
      return_url: `${siteUrl}/master?stripe=return&company=${company.id}`,
      type: "account_onboarding",
    });

    await service.from("organizations").update({
      stripe_connect_onboarding_url: accountLink.url,
      stripe_connect_status: company.stripe_connect_status === "enabled" ? "enabled" : "onboarding",
    }).eq("id", company.id);

    return NextResponse.json({ url: accountLink.url, accountId });
  } catch (error) {
    return fail(error);
  }
}
