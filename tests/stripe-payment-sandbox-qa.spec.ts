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
const targets = {
  susan: {
    customerId: "5578ab78-a721-4a12-adee-6b651f5602ae",
    invoiceId: "e1f9fbb0-0d42-46b7-b179-17c07ee373ca",
    amountCents: 6700,
    expectedFee: 10.05,
    expectedTransfer: 56.95,
    card: "4242424242424242",
  },
  isabelly: {
    customerId: "99b912ba-85a0-4abd-8146-a7bd3f896523",
    invoiceId: "336cef33-bc0d-4050-9c9a-3224cd636c74",
    amountCents: 10000,
    expectedFee: 25,
    expectedTransfer: 75,
    card: "4000000000000259",
  },
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function responseJson(response: any, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
}

function stripeEvent(type: string, object: any, eventId: string) {
  return {
    id: eventId,
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

async function deliverWebhook(request: any, event: any) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return responseJson(await request.post(`${appUrl}/api/stripe/webhook`, {
    headers: { "content-type": "application/json", "stripe-signature": signature },
    data: payload,
  }), `Webhook ${event.type}`);
}

async function fillCheckout(page: any, url: string, cardNumber: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page).toHaveURL(/checkout\.stripe\.com/);

  const card = page.locator("#cardNumber, input[name='cardNumber']").first();
  const expiry = page.locator("#cardExpiry, input[name='cardExpiry']").first();
  const cvc = page.locator("#cardCvc, input[name='cardCvc']").first();
  const name = page.locator("#billingName, input[name='billingName']").first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.fill(cardNumber);
  await expiry.fill("0229");
  await cvc.fill("123");
  if (await name.count()) await name.fill("Damasio QA");

  const pay = page.getByRole("button", { name: /^pay/i }).last();
  await pay.click();
  await page.waitForURL((u: URL) => u.toString().startsWith(`${appUrl}/payment/success`), { timeout: 45_000 });
}

async function createTemporaryCustomerLogin(service: any, customerId: string, label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const authEmail = `stripe.qa.${label}.${suffix}@4everseasons.test`;
  const password = `QaStripe!${suffix}Aa1`;

  const customerResult = await service.from("customers")
    .select("id,full_name,email,profile_id,company_id,organization_id")
    .eq("id", customerId)
    .single();
  expect(customerResult.error, customerResult.error?.message).toBeNull();
  const customer = customerResult.data;
  const originalProfileId = customer.profile_id || null;
  const profileEmail = String(customer.email || authEmail);

  const created = await service.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Stripe QA ${label}`, role: "customer", company_id: companyId, customer_id: customerId },
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

  const linked = await service.from("customers").update({ profile_id: profileId }).eq("id", customerId).select("profile_id").single();
  expect(linked.error, linked.error?.message).toBeNull();
  expect(linked.data?.profile_id).toBe(profileId);

  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const signed = await auth.auth.signInWithPassword({ email: authEmail, password });
  expect(signed.error, signed.error?.message).toBeNull();
  const token = signed.data.session?.access_token || "";
  expect(token).not.toBe("");

  return {
    token,
    profileId,
    originalProfileId,
    async cleanup() {
      await service.from("customers").update({ profile_id: originalProfileId }).eq("id", customerId);
      await service.from("profiles").delete().eq("id", profileId);
      await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    },
  };
}

async function payInvoice({ request, page, service, stripe, target, token, label }: any) {
  const before = await service.from("invoices")
    .select("id,status,total,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("id", target.invoiceId)
    .single();
  expect(before.error, before.error?.message).toBeNull();
  expect(before.data?.status).toBe("waiting_payment");
  expect(Math.round(Number(before.data?.total || 0) * 100)).toBe(target.amountCents);

  const checkout = await responseJson(await request.post(`${appUrl}/api/stripe/checkout`, {
    headers: { authorization: `Bearer ${token}` },
    data: { invoiceId: target.invoiceId },
  }), `${label} checkout`);
  expect(String(checkout.url || "")).toContain("checkout.stripe.com");

  const processing = await service.from("invoices").select("status,stripe_checkout_session_id").eq("id", target.invoiceId).single();
  expect(processing.error, processing.error?.message).toBeNull();
  expect(processing.data?.status).toBe("processing");
  const sessionId = String(processing.data?.stripe_checkout_session_id || "");
  expect(sessionId.startsWith("cs_test_")).toBeTruthy();

  const initialSession = await stripe.checkout.sessions.retrieve(sessionId);
  expect(initialSession.livemode).toBe(false);
  expect(initialSession.amount_total).toBe(target.amountCents);
  expect(initialSession.metadata?.invoiceId).toBe(target.invoiceId);

  await fillCheckout(page, String(checkout.url), target.card);

  let paidSession: any = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    paidSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (paidSession.payment_status === "paid") break;
    await sleep(500);
  }
  expect(paidSession?.payment_status).toBe("paid");
  const paymentIntentId = typeof paidSession.payment_intent === "string" ? paidSession.payment_intent : paidSession.payment_intent?.id;
  expect(String(paymentIntentId || "").startsWith("pi_")).toBeTruthy();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  expect(intent.livemode).toBe(false);
  expect(intent.amount_received).toBe(target.amountCents);

  const paidEvent = stripeEvent("payment_intent.succeeded", intent, `evt_qa_${label}_paid_${Date.now()}`);
  const firstDelivery = await deliverWebhook(request, paidEvent);
  expect(firstDelivery.received).toBe(true);
  const replay = await deliverWebhook(request, paidEvent);
  expect(replay.duplicate).toBe(true);

  const invoice = await service.from("invoices")
    .select("status,stripe_payment_intent_id,stripe_platform_fee,stripe_transfer_amount")
    .eq("id", target.invoiceId)
    .single();
  expect(invoice.error, invoice.error?.message).toBeNull();
  expect(invoice.data?.status).toBe("paid");
  expect(invoice.data?.stripe_payment_intent_id).toBe(paymentIntentId);
  expect(Number(invoice.data?.stripe_platform_fee)).toBeCloseTo(target.expectedFee, 2);
  expect(Number(invoice.data?.stripe_transfer_amount)).toBeCloseTo(target.expectedTransfer, 2);

  const payment = await service.from("payments")
    .select("id,status,amount,stripe_payment_intent_id,stripe_charge_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .single();
  expect(payment.error, payment.error?.message).toBeNull();
  expect(payment.data?.status).toBe("paid");
  expect(Number(payment.data?.amount)).toBeCloseTo(target.amountCents / 100, 2);

  const payout = await service.from("company_payout_items")
    .select("id,status,platform_fee,transfer_amount,stripe_transfer_id,reversed_transfer_amount")
    .eq("payment_id", payment.data.id)
    .single();
  expect(payout.error, payout.error?.message).toBeNull();
  expect(Number(payout.data?.platform_fee)).toBeCloseTo(target.expectedFee, 2);
  expect(Number(payout.data?.transfer_amount)).toBeCloseTo(target.expectedTransfer, 2);

  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  expect(String(chargeId || "").startsWith("ch_")).toBeTruthy();
  return { sessionId, paymentIntentId, chargeId, paymentId: payment.data.id, payoutId: payout.data.id };
}

test("Susan refund and Isabelly dispute complete through Stripe sandbox + canonical webhook", async ({ request, page }) => {
  test.setTimeout(180_000);
  if (!stripeKey.startsWith("sk_test_")) throw new Error("Live Stripe keys are forbidden in this QA test.");
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is required for local signed webhook delivery.");

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const susanLogin = await createTemporaryCustomerLogin(service, targets.susan.customerId, "susan");
  let isabellyLogin: Awaited<ReturnType<typeof createTemporaryCustomerLogin>> | null = null;

  try {
    const susan = await payInvoice({ request, page, service, stripe, target: targets.susan, token: susanLogin.token, label: "susan" });

    await stripe.refunds.create({ payment_intent: susan.paymentIntentId, reason: "requested_by_customer" });
    const refundedCharge = await stripe.charges.retrieve(susan.chargeId);
    expect(refundedCharge.refunded).toBe(true);
    await deliverWebhook(request, stripeEvent("charge.refunded", refundedCharge, `evt_qa_susan_refund_${Date.now()}`));

    const susanInvoice = await service.from("invoices").select("status").eq("id", targets.susan.invoiceId).single();
    const susanPayment = await service.from("payments").select("status").eq("id", susan.paymentId).single();
    const susanPayout = await service.from("company_payout_items").select("status").eq("id", susan.payoutId).single();
    expect(susanInvoice.data?.status).toBe("refunded");
    expect(susanPayment.data?.status).toBe("refunded");
    expect(susanPayout.data?.status).toBe("refunded");

    isabellyLogin = await createTemporaryCustomerLogin(service, targets.isabelly.customerId, "isabelly");
    const isabelly = await payInvoice({ request, page, service, stripe, target: targets.isabelly, token: isabellyLogin.token, label: "isabelly" });

    let dispute: any = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const disputes = await stripe.disputes.list({ limit: 100 });
      dispute = disputes.data.find((item: any) => {
        const charge = typeof item.charge === "string" ? item.charge : item.charge?.id;
        return charge === isabelly.chargeId;
      }) || null;
      if (dispute) break;
      await sleep(1000);
    }
    expect(dispute, "Stripe test dispute was not created for Isabelly test card").toBeTruthy();
    await deliverWebhook(request, stripeEvent("charge.dispute.created", dispute, `evt_qa_isabelly_dispute_${Date.now()}`));

    const isabellyInvoice = await service.from("invoices").select("status").eq("id", targets.isabelly.invoiceId).single();
    const isabellyPayment = await service.from("payments").select("status").eq("id", isabelly.paymentId).single();
    const isabellyPayout = await service.from("company_payout_items").select("status,hold_reason").eq("id", isabelly.payoutId).single();
    expect(isabellyInvoice.data?.status).toBe("paid");
    expect(isabellyPayment.data?.status).toBe("paid");
    expect(isabellyPayout.data?.status).toBe("disputed");
    expect(String(isabellyPayout.data?.hold_reason || "")).toContain(String(dispute.id));

    console.log(JSON.stringify({
      checkpoint: "stripe-sandbox-real-targets-complete",
      susan: { paymentIntentId: susan.paymentIntentId, outcome: "refunded", fee: 10.05, transfer: 56.95 },
      isabelly: { paymentIntentId: isabelly.paymentIntentId, disputeId: dispute.id, outcome: "disputed", fee: 25, transfer: 75 },
      livemode: false,
    }));
  } finally {
    if (isabellyLogin) await isabellyLogin.cleanup();
    await susanLogin.cleanup();
  }
});
