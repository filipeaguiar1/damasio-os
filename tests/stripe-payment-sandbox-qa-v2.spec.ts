import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const companyId = "5a72fc1b-81b8-40bf-86f6-3bd98c1dc4b8";

const TARGETS = [
  {
    label: "susan",
    customerId: "5578ab78-a721-4a12-adee-6b651f5602ae",
    invoiceId: "e1f9fbb0-0d42-46b7-b179-17c07ee373ca",
    amountCents: 6700,
    fee: 10.05,
    transfer: 56.95,
    card: "4242424242424242",
    outcome: "refund",
  },
  {
    label: "isabelly",
    customerId: "99b912ba-85a0-4abd-8146-a7bd3f896523",
    invoiceId: "336cef33-bc0d-4050-9c9a-3224cd636c74",
    amountCents: 10000,
    fee: 25,
    transfer: 75,
    card: "4000000000000259",
    outcome: "dispute",
  },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function parse(response: any, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
}

function event(type: string, object: any, id: string) {
  return {
    id,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
  };
}

async function webhook(request: any, stripeEvent: any) {
  const payload = JSON.stringify(stripeEvent);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return parse(await request.post(`${appUrl}/api/stripe/webhook`, {
    headers: { "content-type": "application/json", "stripe-signature": signature },
    data: payload,
  }), `webhook ${stripeEvent.type}`);
}

async function fillIfVisible(page: any, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      const visible = await locator.isVisible().catch(() => false);
      if (visible) {
        await locator.fill(value);
        return true;
      }
    }
  }
  return false;
}

async function completeHostedCheckout(page: any, url: string, cardNumber: string, label: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page).toHaveURL(/checkout\.stripe\.com/);

  await fillIfVisible(page, ["#cardNumber", "input[name='cardNumber']"], cardNumber);
  await fillIfVisible(page, ["#cardExpiry", "input[name='cardExpiry']"], "0229");
  await fillIfVisible(page, ["#cardCvc", "input[name='cardCvc']"], "123");
  await fillIfVisible(page, ["#billingName", "input[name='billingName']"], "Damasio QA");
  await fillIfVisible(page, ["#billingPostalCode", "input[name='billingPostalCode']", "input[name='postalCode']", "input[autocomplete='postal-code']"], "94107");

  const submit = page.locator("button[type='submit']").filter({ hasText: /pay/i }).last();
  if (!(await submit.count())) {
    throw new Error(`Stripe submit button not found. Body: ${(await page.locator("body").innerText()).slice(0, 2500)}`);
  }
  await submit.click();

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (page.url().startsWith(`${appUrl}/payment/success`)) return;
    if (attempt === 6) {
      console.log(`STRIPE_${label.toUpperCase()}_URL=${page.url()}`);
      console.log(`STRIPE_${label.toUpperCase()}_BODY=${(await page.locator("body").innerText()).slice(0, 3500)}`);
      await page.screenshot({ path: `stripe-${label}-after-pay.png`, fullPage: true });
    }
    await sleep(1000);
  }
  throw new Error(`Stripe checkout did not redirect after Pay. URL=${page.url()} Body=${(await page.locator("body").innerText()).slice(0, 3000)}`);
}

async function tempLogin(service: any, customerId: string, label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const authEmail = `stripe.qa.${label}.${suffix}@4everseasons.test`;
  const password = `QaStripe!${suffix}Aa1`;
  const customerResult = await service.from("customers").select("email,profile_id").eq("id", customerId).single();
  expect(customerResult.error, customerResult.error?.message).toBeNull();
  const oldProfileId = customerResult.data?.profile_id || null;
  const profileEmail = String(customerResult.data?.email || authEmail);

  const created = await service.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: { role: "customer", company_id: companyId, customer_id: customerId },
  });
  expect(created.error, created.error?.message).toBeNull();
  const profileId = created.data.user?.id || "";
  expect(profileId).not.toBe("");

  const profile = await service.from("profiles").insert({
    id: profileId,
    organization_id: companyId,
    company_id: companyId,
    role: "customer",
    full_name: `Stripe QA ${label}`,
    email: profileEmail,
    active: true,
  });
  expect(profile.error, profile.error?.message).toBeNull();

  const link = await service.from("customers").update({ profile_id: profileId }).eq("id", customerId);
  expect(link.error, link.error?.message).toBeNull();

  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const signed = await auth.auth.signInWithPassword({ email: authEmail, password });
  expect(signed.error, signed.error?.message).toBeNull();
  const token = signed.data.session?.access_token || "";
  expect(token).not.toBe("");

  return {
    token,
    async cleanup() {
      await service.from("customers").update({ profile_id: oldProfileId }).eq("id", customerId);
      await service.from("profiles").delete().eq("id", profileId);
      await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    },
  };
}

async function payTarget({ request, page, service, stripe, target, token }: any) {
  const before = await service.from("invoices").select("status,total").eq("id", target.invoiceId).single();
  expect(before.error, before.error?.message).toBeNull();
  expect(before.data?.status).toBe("waiting_payment");
  expect(Math.round(Number(before.data?.total || 0) * 100)).toBe(target.amountCents);

  const checkout = await parse(await request.post(`${appUrl}/api/stripe/checkout`, {
    headers: { authorization: `Bearer ${token}` },
    data: { invoiceId: target.invoiceId },
  }), `${target.label} checkout`);

  const invoiceProcessing = await service.from("invoices").select("status,stripe_checkout_session_id").eq("id", target.invoiceId).single();
  expect(invoiceProcessing.data?.status).toBe("processing");
  const sessionId = String(invoiceProcessing.data?.stripe_checkout_session_id || "");
  expect(sessionId.startsWith("cs_test_")).toBeTruthy();

  const initial = await stripe.checkout.sessions.retrieve(sessionId);
  expect(initial.livemode).toBe(false);
  expect(initial.amount_total).toBe(target.amountCents);

  await completeHostedCheckout(page, String(checkout.url), target.card, target.label);

  let session: any = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") break;
    await sleep(500);
  }
  expect(session?.payment_status).toBe("paid");
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  expect(String(piId || "").startsWith("pi_")).toBeTruthy();
  const intent = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
  expect(intent.amount_received).toBe(target.amountCents);

  const paidEvent = event("payment_intent.succeeded", intent, `evt_qa_${target.label}_paid_${Date.now()}`);
  const first = await webhook(request, paidEvent);
  expect(first.received).toBe(true);
  const replay = await webhook(request, paidEvent);
  expect(replay.duplicate).toBe(true);

  const invoice = await service.from("invoices")
    .select("status,stripe_payment_intent_id,stripe_platform_fee,stripe_transfer_amount")
    .eq("id", target.invoiceId).single();
  expect(invoice.data?.status).toBe("paid");
  expect(invoice.data?.stripe_payment_intent_id).toBe(piId);
  expect(Number(invoice.data?.stripe_platform_fee)).toBeCloseTo(target.fee, 2);
  expect(Number(invoice.data?.stripe_transfer_amount)).toBeCloseTo(target.transfer, 2);

  const payment = await service.from("payments").select("id,status,amount").eq("stripe_payment_intent_id", piId).single();
  expect(payment.data?.status).toBe("paid");
  expect(Number(payment.data?.amount)).toBeCloseTo(target.amountCents / 100, 2);
  const payout = await service.from("company_payout_items").select("id,status,platform_fee,transfer_amount").eq("payment_id", payment.data.id).single();
  expect(Number(payout.data?.platform_fee)).toBeCloseTo(target.fee, 2);
  expect(Number(payout.data?.transfer_amount)).toBeCloseTo(target.transfer, 2);

  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  expect(String(chargeId || "").startsWith("ch_")).toBeTruthy();
  return { piId, chargeId, paymentId: payment.data.id, payoutId: payout.data.id };
}

test("real Susan and Isabelly sandbox lifecycle", async ({ request, page }) => {
  test.setTimeout(210_000);
  if (!stripeKey.startsWith("sk_test_")) throw new Error("Live Stripe key forbidden.");
  if (!webhookSecret) throw new Error("Missing local webhook secret.");

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const logins: Array<{ cleanup: () => Promise<void> }> = [];

  try {
    const susanLogin = await tempLogin(service, TARGETS[0].customerId, "susan");
    logins.push(susanLogin);
    const susan = await payTarget({ request, page, service, stripe, target: TARGETS[0], token: susanLogin.token });

    await stripe.refunds.create({ payment_intent: susan.piId, reason: "requested_by_customer" });
    const refundedCharge = await stripe.charges.retrieve(susan.chargeId);
    expect(refundedCharge.refunded).toBe(true);
    await webhook(request, event("charge.refunded", refundedCharge, `evt_qa_susan_refund_${Date.now()}`));
    expect((await service.from("invoices").select("status").eq("id", TARGETS[0].invoiceId).single()).data?.status).toBe("refunded");
    expect((await service.from("payments").select("status").eq("id", susan.paymentId).single()).data?.status).toBe("refunded");
    expect((await service.from("company_payout_items").select("status").eq("id", susan.payoutId).single()).data?.status).toBe("refunded");

    const isabellyLogin = await tempLogin(service, TARGETS[1].customerId, "isabelly");
    logins.push(isabellyLogin);
    const isabelly = await payTarget({ request, page, service, stripe, target: TARGETS[1], token: isabellyLogin.token });

    let dispute: any = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const list = await stripe.disputes.list({ limit: 100 });
      dispute = list.data.find((d: any) => (typeof d.charge === "string" ? d.charge : d.charge?.id) === isabelly.chargeId) || null;
      if (dispute) break;
      await sleep(1000);
    }
    expect(dispute, "Expected Stripe test dispute").toBeTruthy();
    await webhook(request, event("charge.dispute.created", dispute, `evt_qa_isabelly_dispute_${Date.now()}`));
    expect((await service.from("invoices").select("status").eq("id", TARGETS[1].invoiceId).single()).data?.status).toBe("paid");
    expect((await service.from("payments").select("status").eq("id", isabelly.paymentId).single()).data?.status).toBe("paid");
    const held = await service.from("company_payout_items").select("status,hold_reason").eq("id", isabelly.payoutId).single();
    expect(held.data?.status).toBe("disputed");
    expect(String(held.data?.hold_reason || "")).toContain(String(dispute.id));

    console.log(JSON.stringify({ checkpoint: "stripe-sandbox-targets-complete", susan: "refunded", isabelly: "disputed", livemode: false }));
  } finally {
    for (const login of logins.reverse()) await login.cleanup();
  }
});
