import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function environment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (!url || !serviceKey || !stripeKey || !siteUrl) throw new Error("Stripe Connect is not configured.");
  return { url, serviceKey, stripeKey, siteUrl };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe Connect request failed." }, { status });
}

function statusFor(account: Stripe.Account) {
  const enabled = Boolean(account.details_submitted && account.payouts_enabled && account.capabilities?.transfers === "active");
  if (enabled) return "enabled";
  if (account.requirements?.disabled_reason) return "restricted";
  return "onboarding";
}

async function requireCompanyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Company Admin.");
  const { url, serviceKey } = environment();
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin") {
    throw new Error("Only the active Company Admin can manage payout onboarding.");
  }
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(companyId)) throw new Error("Company account could not be resolved.");
  return { service, companyId };
}

async function companyAndAccount(request: NextRequest) {
  const { service, companyId } = await requireCompanyAdmin(request);
  const { stripeKey } = environment();
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const { data: company, error } = await service
    .from("organizations")
    .select("id,name,contact_email,stripe_connected_account_id,stripe_connect_status,stripe_connect_onboarded_at,stripe_payouts_enabled_at,stripe_payout_schedule")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !company) throw new Error(error?.message || "Company not found.");
  return { service, stripe, company };
}

async function enforceManualPayoutSchedule(service: any, accountId: string, companyId: string) {
  const { stripeKey } = environment();
  const response = await fetch("https://api.stripe.com/v1/balance_settings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Stripe-Account": accountId,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ "payments[payouts][schedule][interval]": "manual" }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Stripe could not enable manual payouts: ${detail.slice(0, 400)}`);
  }
  const saved = await service.from("organizations").update({
    stripe_payout_schedule: "manual",
    stripe_payout_schedule_updated_at: new Date().toISOString(),
  }).eq("id", companyId);
  if (saved.error) throw new Error(saved.error.message);
}

export async function GET(request: NextRequest) {
  try {
    const { service, stripe, company } = await companyAndAccount(request);
    if (!company.stripe_connected_account_id) {
      return NextResponse.json({ status: "not_started", payoutsEnabled: false, accountId: null, payoutSchedule: null });
    }
    const account = await stripe.accounts.retrieve(company.stripe_connected_account_id);
    const status = statusFor(account);
    const now = new Date().toISOString();
    if (status === "enabled" && company.stripe_payout_schedule !== "manual") {
      await enforceManualPayoutSchedule(service, account.id, company.id);
    }
    const update = await service.from("organizations").update({
      stripe_connect_status: status,
      stripe_connect_onboarded_at: account.details_submitted ? company.stripe_connect_onboarded_at || now : null,
      stripe_payouts_enabled_at: status === "enabled" ? company.stripe_payouts_enabled_at || now : null,
    }).eq("id", company.id);
    if (update.error) throw new Error(update.error.message);
    return NextResponse.json({
      status,
      payoutsEnabled: status === "enabled",
      payoutSchedule: status === "enabled" ? "manual" : company.stripe_payout_schedule || null,
      accountId: account.id,
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsDue: account.requirements?.currently_due || [],
      disabledReason: account.requirements?.disabled_reason || null,
    });
  } catch (error) {
    return fail(error, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, stripe, company } = await companyAndAccount(request);
    const { siteUrl } = environment();
    let accountId = company.stripe_connected_account_id as string | null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        country: "CA",
        email: company.contact_email || undefined,
        business_profile: {
          name: company.name,
          product_description: "Property maintenance services paid through 4 Ever Seasons.",
        },
        capabilities: { transfers: { requested: true } },
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
          requirement_collection: "stripe",
        },
        metadata: { companyId: company.id, platform: "4ever-seasons" },
      } as Stripe.AccountCreateParams);
      accountId = account.id;
      const saved = await service.from("organizations").update({
        stripe_connected_account_id: accountId,
        stripe_connect_status: "onboarding",
      }).eq("id", company.id);
      if (saved.error) throw new Error(saved.error.message);
    }

    const account = await stripe.accounts.retrieve(accountId);
    const status = statusFor(account);
    const now = new Date().toISOString();
    const statusSaved = await service.from("organizations").update({
      stripe_connect_status: status,
      stripe_connect_onboarded_at: account.details_submitted ? company.stripe_connect_onboarded_at || now : null,
      stripe_payouts_enabled_at: status === "enabled" ? company.stripe_payouts_enabled_at || now : null,
    }).eq("id", company.id);
    if (statusSaved.error) throw new Error(statusSaved.error.message);

    if (status === "enabled") {
      await enforceManualPayoutSchedule(service, accountId, company.id);
      const login = await stripe.accounts.createLoginLink(accountId);
      return NextResponse.json({ status, payoutsEnabled: true, payoutSchedule: "manual", url: login.url, destination: "dashboard" });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${siteUrl}/admin/finance?stripe=refresh`,
      return_url: `${siteUrl}/admin/finance?stripe=return`,
      type: "account_onboarding",
    });
    const linkSaved = await service.from("organizations").update({
      stripe_connect_status: status,
      stripe_connect_onboarding_url: link.url,
    }).eq("id", company.id);
    if (linkSaved.error) throw new Error(linkSaved.error.message);

    return NextResponse.json({ status, payoutsEnabled: false, payoutSchedule: company.stripe_payout_schedule || null, url: link.url, destination: "onboarding" });
  } catch (error) {
    return fail(error, 403);
  }
}
