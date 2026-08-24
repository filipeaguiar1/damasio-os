import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

const invoiceId = "336cef33-bc0d-4050-9c9a-3224cd636c74";
const sessionId = "cs_test_a14NeNug223WsUc0VPIQQ14d22HJ9ybz978W3azXTJTHTvCnm7ipv0GTXR";
const expectedAmount = 10000;
const expectedFee = 25;
const expectedTransfer = 75;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function qaEvent(type: string, object: any, id: string) {
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

async function deliver(request: any, event: any) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const response = await request.post(`${appUrl}/api/stripe/webhook`, {
    headers: { "content-type": "application/json", "stripe-signature": signature },
    data: payload,
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `Webhook ${event.type}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
}

async function fillIfVisible(page: any, selectors: string[], value: string) {
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible().catch(() => false)) {
      await input.fill(value);
      return true;
    }
  }
  return false;
}

test("Isabelly CAD 100 payment and dispute through Stripe sandbox", async ({ request, page }) => {
  test.setTimeout(150_000);
  if (!stripeKey.startsWith("sk_test_")) throw new Error("Live Stripe key is forbidden in QA.");
  if (!webhookSecret) throw new Error("Missing local webhook secret.");

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });

  const before = await service.from("invoices")
    .select("status,total,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("id", invoiceId).single();
  expect(before.error, before.error?.message).toBeNull();
  expect(Number(before.data?.total)).toBe(100);
  expect(before.data?.stripe_checkout_session_id).toBe(sessionId);
  expect(before.data?.stripe_payment_intent_id).toBeNull();

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  expect(session.livemode).toBe(false);
  expect(session.status).toBe("open");
  expect(session.payment_status).toBe("unpaid");
  expect(session.amount_total).toBe(expectedAmount);
  expect(session.metadata?.invoiceId).toBe(invoiceId);
  expect(session.url).toBeTruthy();

  await page.goto(String(session.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page).toHaveURL(/checkout\.stripe\.com/);

  const card = page.locator("#cardNumber, input[name='cardNumber']").first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.fill("4000000000000259");
  await fillIfVisible(page, ["#cardExpiry", "input[name='cardExpiry']"], "0229");
  await fillIfVisible(page, ["#cardCvc", "input[name='cardCvc']"], "123");
  await fillIfVisible(page, ["#billingName", "input[name='billingName']"], "Damasio QA");
  await fillIfVisible(page, ["#billingPostalCode", "input[name='billingPostalCode']", "input[name='postalCode']", "input[autocomplete='postal-code']"], "94107");

  const saveInfo = page.getByRole("checkbox", { name: /save my information/i }).first();
  if (await saveInfo.count() && await saveInfo.isChecked().catch(() => false)) {
    await saveInfo.uncheck();
  }

  const aiAgentDisclosure = page.getByRole("checkbox", { name: /i am an ai agent acting on behalf of someone else/i }).first();
  if (await aiAgentDisclosure.count() && !(await aiAgentDisclosure.isChecked().catch(() => false))) {
    await aiAgentDisclosure.check();
  }

  const submit = page.getByRole("button", { name: /^pay/i }).last();
  await submit.waitFor({ state: "visible", timeout: 30_000 });
  await submit.click();

  let paidSession: any = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    paidSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (paidSession.payment_status === "paid") break;
    await sleep(1000);
  }
  if (paidSession?.payment_status !== "paid") {
    console.log(`CHECKOUT_URL=${page.url()}`);
    console.log(`CHECKOUT_BODY=${(await page.locator("body").innerText().catch(() => "")).slice(0, 2500)}`);
    await page.screenshot({ path: "stripe-isabelly-unpaid.png", fullPage: true }).catch(() => undefined);
  }
  expect(paidSession?.payment_status).toBe("paid");

  const paymentIntentId = typeof paidSession.payment_intent === "string"
    ? paidSession.payment_intent
    : paidSession.payment_intent?.id;
  expect(String(paymentIntentId || "").startsWith("pi_")).toBeTruthy();

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  expect(intent.livemode).toBe(false);
  expect(intent.amount_received).toBe(expectedAmount);
  expect(intent.metadata.invoiceId).toBe(invoiceId);

  const succeeded = qaEvent("payment_intent.succeeded", intent, `evt_qa_isabelly_paid_${Date.now()}`);
  const first = await deliver(request, succeeded);
  expect(first.received).toBe(true);
  const replay = await deliver(request, succeeded);
  expect(replay.duplicate).toBe(true);

  const invoice = await service.from("invoices")
    .select("status,stripe_payment_intent_id,stripe_platform_fee,stripe_transfer_amount")
    .eq("id", invoiceId).single();
  expect(invoice.error, invoice.error?.message).toBeNull();
  expect(invoice.data?.status).toBe("paid");
  expect(invoice.data?.stripe_payment_intent_id).toBe(paymentIntentId);
  expect(Number(invoice.data?.stripe_platform_fee)).toBeCloseTo(expectedFee, 2);
  expect(Number(invoice.data?.stripe_transfer_amount)).toBeCloseTo(expectedTransfer, 2);

  const payment = await service.from("payments")
    .select("id,status,amount,stripe_charge_id")
    .eq("stripe_payment_intent_id", paymentIntentId).single();
  expect(payment.error, payment.error?.message).toBeNull();
  expect(payment.data?.status).toBe("paid");
  expect(Number(payment.data?.amount)).toBe(100);

  const payout = await service.from("company_payout_items")
    .select("id,status,platform_fee,transfer_amount,hold_reason")
    .eq("payment_id", payment.data.id).single();
  expect(payout.error, payout.error?.message).toBeNull();
  expect(Number(payout.data?.platform_fee)).toBeCloseTo(expectedFee, 2);
  expect(Number(payout.data?.transfer_amount)).toBeCloseTo(expectedTransfer, 2);

  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  expect(String(chargeId || "").startsWith("ch_")).toBeTruthy();

  let dispute: any = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const disputes = await stripe.disputes.list({ limit: 100 });
    dispute = disputes.data.find((item: any) => {
      const charge = typeof item.charge === "string" ? item.charge : item.charge?.id;
      return charge === chargeId;
    }) || null;
    if (dispute) break;
    await sleep(1000);
  }
  expect(dispute, "Stripe did not create the expected test dispute").toBeTruthy();

  await deliver(request, qaEvent("charge.dispute.created", dispute, `evt_qa_isabelly_dispute_${Date.now()}`));

  const held = await service.from("company_payout_items")
    .select("status,hold_reason,platform_fee,transfer_amount")
    .eq("id", payout.data.id).single();
  expect(held.error, held.error?.message).toBeNull();
  expect(held.data?.status).toBe("disputed");
  expect(String(held.data?.hold_reason || "")).toContain(String(dispute.id));
  expect(Number(held.data?.platform_fee)).toBeCloseTo(expectedFee, 2);
  expect(Number(held.data?.transfer_amount)).toBeCloseTo(expectedTransfer, 2);

  const finalInvoice = await service.from("invoices").select("status").eq("id", invoiceId).single();
  const finalPayment = await service.from("payments").select("status").eq("id", payment.data.id).single();
  expect(finalInvoice.data?.status).toBe("paid");
  expect(finalPayment.data?.status).toBe("paid");

  console.log(JSON.stringify({
    checkpoint: "isabelly-sandbox-payment-dispute-complete",
    paymentIntentId,
    chargeId,
    disputeId: dispute.id,
    platformFee: expectedFee,
    companyTransfer: expectedTransfer,
    livemode: false,
  }));
});
