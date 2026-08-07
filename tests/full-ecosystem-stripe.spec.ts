import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stripeKey = process.env.STRIPE_SECRET_KEY || "";

async function json(response: any, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
}

test("Stripe test mode creates/cancels invoice checkout and creates tip checkout", async ({ request }) => {
  test.setTimeout(90_000);
  if (!stripeKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be configured in GitHub Actions with a Stripe sk_test_ key. Live Stripe keys are forbidden in this E2E gate.");
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyId = randomUUID();
  const customerId = randomUUID();
  const propertyId = randomUUID();
  const quoteId = randomUUID();
  const invoiceId = randomUUID();
  const email = `damasio.stripe.qa.${suffix}@example.com`;
  const password = `QaStripe!${suffix}Aa1`;
  let profileId = "";
  let invoiceSessionId = "";
  let tipSessionId = "";

  try {
    const organization = await service.from("organizations").insert({
      id: companyId,
      name: `QA Stripe ${suffix}`,
      slug: `qa-stripe-${suffix}`.toLowerCase(),
      active: true,
      plan_name: "professional",
      contact_email: email,
    });
    expect(organization.error, organization.error?.message).toBeNull();

    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "QA Stripe Customer", role: "customer", company_id: companyId, customer_id: customerId },
    });
    expect(created.error, created.error?.message).toBeNull();
    profileId = created.data.user?.id || "";
    expect(profileId).not.toBe("");

    const profile = await service.from("profiles").upsert({
      id: profileId,
      organization_id: companyId,
      company_id: companyId,
      role: "customer",
      full_name: "QA Stripe Customer",
      email,
      active: true,
    });
    expect(profile.error, profile.error?.message).toBeNull();

    const customer = await service.from("customers").insert({
      id: customerId,
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      profile_id: profileId,
      full_name: "QA Stripe Customer",
      email,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
    });
    expect(customer.error, customer.error?.message).toBeNull();

    const property = await service.from("properties").insert({
      id: propertyId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      address_line1: "100 Main St W",
      city: "Hamilton",
      province: "ON",
      postal_code: "L8P 1H6",
      country: "Canada",
    });
    expect(property.error, property.error?.message).toBeNull();

    const quote = await service.from("quotes").insert({
      id: quoteId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: `QA-STRIPE-${suffix}`,
      status: "approved",
      subtotal: 40,
      tax: 5.2,
      total: 45.2,
    });
    expect(quote.error, quote.error?.message).toBeNull();

    const invoice = await service.from("invoices").insert({
      id: invoiceId,
      organization_id: companyId,
      company_id: companyId,
      quote_id: quoteId,
      customer_id: customerId,
      property_id: propertyId,
      invoice_number: `QA-I-${suffix}`,
      status: "waiting_payment",
      subtotal: 40,
      tax: 5.2,
      total: 45.2,
    });
    expect(invoice.error, invoice.error?.message).toBeNull();

    const signed = await auth.auth.signInWithPassword({ email, password });
    expect(signed.error, signed.error?.message).toBeNull();
    const token = signed.data.session?.access_token;
    expect(token).toBeTruthy();

    const checkout = await json(await request.post(`${appUrl}/api/stripe/checkout`, {
      headers: { authorization: `Bearer ${token}` },
      data: { invoiceId },
    }), "Invoice checkout");
    expect(String(checkout.url || "")).toContain("checkout.stripe.com");

    const invoiceAfterCreate = await service.from("invoices")
      .select("status,stripe_checkout_session_id")
      .eq("id", invoiceId)
      .single();
    expect(invoiceAfterCreate.error, invoiceAfterCreate.error?.message).toBeNull();
    expect(invoiceAfterCreate.data?.status).toBe("processing");
    invoiceSessionId = String(invoiceAfterCreate.data?.stripe_checkout_session_id || "");
    expect(invoiceSessionId.startsWith("cs_test_")).toBeTruthy();

    const stripeInvoiceSession = await stripe.checkout.sessions.retrieve(invoiceSessionId);
    expect(stripeInvoiceSession.livemode).toBe(false);
    expect(stripeInvoiceSession.metadata?.invoiceId).toBe(invoiceId);
    expect(stripeInvoiceSession.metadata?.customerId).toBe(customerId);
    expect(stripeInvoiceSession.amount_total).toBe(4520);
    expect(stripeInvoiceSession.currency).toBe("cad");

    const cancelled = await json(await request.delete(`${appUrl}/api/stripe/checkout`, {
      headers: { authorization: `Bearer ${token}` },
      data: { invoiceId },
    }), "Invoice checkout cancellation");
    expect(cancelled.cancelled).toBe(true);

    const invoiceAfterCancel = await service.from("invoices").select("status").eq("id", invoiceId).single();
    expect(invoiceAfterCancel.error, invoiceAfterCancel.error?.message).toBeNull();
    expect(invoiceAfterCancel.data?.status).toBe("waiting_payment");
    const expiredSession = await stripe.checkout.sessions.retrieve(invoiceSessionId);
    expect(expiredSession.status).toBe("expired");
    expect(expiredSession.livemode).toBe(false);

    const tip = await json(await request.post(`${appUrl}/api/stripe/tips`, {
      headers: { authorization: `Bearer ${token}` },
      data: { amount: 7.25, returnPath: "/customer/feedback", note: "QA test-mode tip" },
    }), "Tip checkout");
    expect(String(tip.url || "")).toContain("checkout.stripe.com");
    const match = String(tip.url || "").match(/(cs_test_[A-Za-z0-9_]+)/);
    expect(match?.[1]).toBeTruthy();
    tipSessionId = String(match?.[1] || "");

    const stripeTipSession = await stripe.checkout.sessions.retrieve(tipSessionId);
    expect(stripeTipSession.livemode).toBe(false);
    expect(stripeTipSession.metadata?.paymentKind).toBe("customer_tip");
    expect(stripeTipSession.metadata?.customerId).toBe(customerId);
    expect(stripeTipSession.metadata?.profileId).toBe(profileId);
    expect(stripeTipSession.metadata?.amountCents).toBe("725");
    expect(stripeTipSession.amount_total).toBe(725);
    expect(stripeTipSession.currency).toBe("cad");

    console.log(JSON.stringify({
      checkpoint: "stripe-test-mode-checkout-and-tip",
      invoiceSessionId,
      tipSessionId,
      livemode: false,
    }));
  } finally {
    if (tipSessionId) {
      const session = await stripe.checkout.sessions.retrieve(tipSessionId).catch(() => null);
      if (session?.status === "open") await stripe.checkout.sessions.expire(tipSessionId).catch(() => undefined);
    }
    if (invoiceSessionId) {
      const session = await stripe.checkout.sessions.retrieve(invoiceSessionId).catch(() => null);
      if (session?.status === "open") await stripe.checkout.sessions.expire(invoiceSessionId).catch(() => undefined);
    }
    try { await service.from("customer_tips").delete().eq("customer_id", customerId); } catch { /* best-effort QA cleanup */ }
    await service.from("invoices").delete().eq("id", invoiceId);
    await service.from("quotes").delete().eq("id", quoteId);
    await service.from("properties").delete().eq("id", propertyId);
    await service.from("customers").delete().eq("id", customerId);
    if (profileId) {
      await service.from("profiles").delete().eq("id", profileId);
      await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    }
    await service.from("organizations").delete().eq("id", companyId);
  }
});
