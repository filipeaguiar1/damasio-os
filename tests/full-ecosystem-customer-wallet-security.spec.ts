import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stripeKey = process.env.STRIPE_SECRET_KEY || "";

async function body(response: any, label: string) {
  const text = await response.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return parsed;
}

test("Customer wallet and tips ignore tampered user_metadata Customer IDs", async ({ request }) => {
  test.setTimeout(120_000);
  if (!stripeKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test key for wallet security E2E.");
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyId = randomUUID();
  const canonicalCustomerId = randomUUID();
  const decoyCustomerId = randomUUID();
  const email = `wallet.identity.${suffix}@4everseasons.test`;
  const password = `QaWallet!${suffix}Aa1`;
  let profileId = "";
  let walletTopupSessionId = "";
  let cardTipSessionId = "";

  try {
    const organization = await service.from("organizations").insert({
      id: companyId,
      name: `QA Wallet Identity ${suffix}`,
      slug: `qa-wallet-identity-${suffix}`.toLowerCase(),
      active: true,
      plan_name: "professional",
      contact_email: email,
    });
    expect(organization.error, organization.error?.message).toBeNull();

    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "QA Wallet Customer", role: "customer", company_id: companyId },
    });
    expect(created.error, created.error?.message).toBeNull();
    profileId = created.data.user?.id || "";
    expect(profileId).not.toBe("");

    const profile = await service.from("profiles").upsert({
      id: profileId,
      organization_id: companyId,
      company_id: companyId,
      role: "customer",
      full_name: "QA Wallet Customer",
      email,
      active: true,
    });
    expect(profile.error, profile.error?.message).toBeNull();

    const canonical = await service.from("customers").insert({
      id: canonicalCustomerId,
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      profile_id: profileId,
      full_name: "QA Canonical Wallet Customer",
      email,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
    });
    expect(canonical.error, canonical.error?.message).toBeNull();

    const decoy = await service.from("customers").insert({
      id: decoyCustomerId,
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      profile_id: null,
      full_name: "QA Decoy Wallet Customer",
      email,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
    });
    expect(decoy.error, decoy.error?.message).toBeNull();

    const poisonedMetadata = await service.auth.admin.updateUserById(profileId, {
      user_metadata: {
        full_name: "QA Wallet Customer",
        role: "customer",
        company_id: companyId,
        customer_id: decoyCustomerId,
      },
    });
    expect(poisonedMetadata.error, poisonedMetadata.error?.message).toBeNull();

    const signed = await auth.auth.signInWithPassword({ email, password });
    expect(signed.error, signed.error?.message).toBeNull();
    const token = signed.data.session?.access_token || "";
    expect(token).not.toBe("");

    const walletRead = await body(await request.get(`${appUrl}/api/stripe/wallet`, {
      headers: { authorization: `Bearer ${token}` },
    }), "Wallet read");
    expect(walletRead.customerId).toBe(canonicalCustomerId);

    const walletTopup = await body(await request.post(`${appUrl}/api/stripe/wallet`, {
      headers: { authorization: `Bearer ${token}` },
      data: { credits: 10, returnPath: "/customer/payments" },
    }), "Wallet top-up checkout");
    expect(String(walletTopup.url || "")).toContain("checkout.stripe.com");
    const walletMatch = String(walletTopup.url || "").match(/(cs_test_[A-Za-z0-9_]+)/);
    walletTopupSessionId = String(walletMatch?.[1] || "");
    expect(walletTopupSessionId).not.toBe("");
    const walletSession = await stripe.checkout.sessions.retrieve(walletTopupSessionId);
    expect(walletSession.metadata?.customerId).toBe(canonicalCustomerId);
    expect(walletSession.metadata?.profileId).toBe(profileId);
    expect(walletSession.metadata?.companyId).toBe(companyId);

    const walletSeed = await service.from("customer_wallets").upsert({
      company_id: companyId,
      customer_id: canonicalCustomerId,
      balance_cents: 2000,
    }, { onConflict: "customer_id" });
    expect(walletSeed.error, walletSeed.error?.message).toBeNull();

    const walletTip = await body(await request.post(`${appUrl}/api/stripe/tips/wallet`, {
      headers: { authorization: `Bearer ${token}` },
      data: { amount: 5, note: "QA canonical wallet tip" },
    }), "Wallet tip");
    expect(walletTip.paid).toBe(true);
    expect(walletTip.balanceCredits).toBe(15);

    const canonicalWallet = await service.from("customer_wallets").select("balance_cents").eq("customer_id", canonicalCustomerId).single();
    expect(canonicalWallet.error, canonicalWallet.error?.message).toBeNull();
    expect(canonicalWallet.data?.balance_cents).toBe(1500);
    const decoyWallet = await service.from("customer_wallets").select("id").eq("customer_id", decoyCustomerId);
    expect(decoyWallet.error, decoyWallet.error?.message).toBeNull();
    expect(decoyWallet.data || []).toHaveLength(0);
    const walletTipLedger = await service.from("customer_tips").select("customer_id,amount_cents,payment_method").eq("customer_id", canonicalCustomerId).eq("payment_method", "wallet");
    expect(walletTipLedger.error, walletTipLedger.error?.message).toBeNull();
    expect(walletTipLedger.data?.some((row: any) => row.customer_id === canonicalCustomerId && Number(row.amount_cents) === 500)).toBeTruthy();

    const cardTip = await body(await request.post(`${appUrl}/api/stripe/tips`, {
      headers: { authorization: `Bearer ${token}` },
      data: { amount: 6, returnPath: "/customer/feedback", note: "QA canonical card tip" },
    }), "Card tip checkout");
    const cardMatch = String(cardTip.url || "").match(/(cs_test_[A-Za-z0-9_]+)/);
    cardTipSessionId = String(cardMatch?.[1] || "");
    expect(cardTipSessionId).not.toBe("");
    const cardSession = await stripe.checkout.sessions.retrieve(cardTipSessionId);
    expect(cardSession.metadata?.customerId).toBe(canonicalCustomerId);
    expect(cardSession.metadata?.profileId).toBe(profileId);
    expect(cardSession.metadata?.companyId).toBe(companyId);

    console.log(JSON.stringify({
      checkpoint: "customer-wallet-canonical-identity",
      canonicalCustomerId,
      decoyCustomerId,
      walletTopupSessionId,
      cardTipSessionId,
    }));
  } finally {
    for (const sessionId of [walletTopupSessionId, cardTipSessionId].filter(Boolean)) {
      const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
      if (session?.status === "open") await stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
    }
    await service.from("customer_tips").delete().in("customer_id", [canonicalCustomerId, decoyCustomerId]);
    await service.from("customer_wallet_transactions").delete().in("customer_id", [canonicalCustomerId, decoyCustomerId]);
    await service.from("customer_wallets").delete().in("customer_id", [canonicalCustomerId, decoyCustomerId]);
    await service.from("customers").delete().in("id", [canonicalCustomerId, decoyCustomerId]);
    if (profileId) {
      await service.from("profiles").delete().eq("id", profileId);
      await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    }
    await service.from("organizations").delete().eq("id", companyId);
  }
});
