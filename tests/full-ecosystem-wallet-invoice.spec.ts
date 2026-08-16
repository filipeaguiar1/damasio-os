import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function json(response: any, label: string) {
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return payload;
}

test("validated after-Visit Invoice can be paid once from canonical account balance", async ({ request }) => {
  test.setTimeout(120_000);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyId = randomUUID();
  const customerId = randomUUID();
  const propertyId = randomUUID();
  const jobId = randomUUID();
  const agreementId = randomUUID();
  const email = `wallet.invoice.${suffix}@4everseasons.test`;
  const password = `QaWalletInvoice!${suffix}Aa1`;
  let profileId = "";
  let visitId = "";
  let eventId = "";
  let invoiceId = "";
  let paymentId = "";
  let payoutId = "";

  try {
    const organization = await service.from("organizations").insert({
      id: companyId,
      name: `QA Wallet Invoice ${suffix}`,
      slug: `qa-wallet-invoice-${suffix}`.toLowerCase(),
      active: true,
      plan_name: "professional",
      contact_email: email,
    });
    expect(organization.error, organization.error?.message).toBeNull();

    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "QA Wallet Invoice Customer" },
    });
    expect(created.error, created.error?.message).toBeNull();
    profileId = created.data.user?.id || "";
    expect(profileId).not.toBe("");

    const profile = await service.from("profiles").upsert({
      id: profileId,
      organization_id: companyId,
      company_id: companyId,
      role: "customer",
      full_name: "QA Wallet Invoice Customer",
      email,
      active: true,
    });
    expect(profile.error, profile.error?.message).toBeNull();

    const customer = await service.from("customers").insert({
      id: customerId,
      organization_id: companyId,
      company_id: companyId,
      origin_company_id: companyId,
      service_company_id: companyId,
      profile_id: profileId,
      full_name: "QA Wallet Invoice Customer",
      email,
      acquisition_source: "platform",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: true,
    });
    expect(customer.error, customer.error?.message).toBeNull();

    const property = await service.from("properties").insert({
      id: propertyId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      address_line1: "105 Wallet Invoice Way",
      city: "Hamilton",
      province: "ON",
      country: "Canada",
    });
    expect(property.error, property.error?.message).toBeNull();

    const job = await service.from("jobs").insert({
      id: jobId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      service_name: "QA Wallet Invoice Service",
      frequency: "weekly",
      service_frequency: "weekly",
      active: true,
      billing_model: "per_visit_fixed_payout",
    });
    expect(job.error, job.error?.message).toBeNull();

    const agreement = await service.from("billing_agreements").insert({
      id: agreementId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      job_id: jobId,
      customer_origin: "platform",
      contract_owner_role: "master",
      billing_model: "per_visit_fixed_payout",
      collection_timing: "after_visit",
      service_frequency: "weekly",
      customer_amount_cents: 10000,
      provider_payout_cents: 7500,
      feedback_window_hours: 24,
      contract_starts_on: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      contract_ends_on: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      ownership_type: "master",
      payment_status: "active",
      active: true,
      tax_rate_basis_points: 1300,
      tax_label: "HST",
    });
    expect(agreement.error, agreement.error?.message).toBeNull();

    const visit = await service.from("visits").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      job_id: jobId,
      scheduled_date: new Date().toISOString().slice(0, 10),
      status: "scheduled",
    }).select("id").single();
    expect(visit.error, visit.error?.message).toBeNull();
    visitId = visit.data.id;

    const started = await service.from("visits").update({
      status: "in_progress",
      started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }).eq("id", visitId);
    expect(started.error, started.error?.message).toBeNull();

    const completed = await service.from("visits").update({
      status: "completed",
      finished_at: new Date().toISOString(),
      duration_seconds: 1800,
    }).eq("id", visitId);
    expect(completed.error, completed.error?.message).toBeNull();

    const feedback = await service.from("feedback").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      visit_id: visitId,
      rating: 5,
      comment: "Ready for wallet payment",
    });
    expect(feedback.error, feedback.error?.message).toBeNull();

    const event = await service.from("visit_billing_events")
      .select("id,state")
      .eq("visit_id", visitId)
      .single();
    expect(event.error, event.error?.message).toBeNull();
    eventId = event.data.id;
    expect(event.data.state).toBe("release_pending");

    const invoice = await service.from("invoices")
      .select("id,status,total")
      .eq("billing_event_id", eventId)
      .single();
    expect(invoice.error, invoice.error?.message).toBeNull();
    invoiceId = invoice.data.id;
    expect(Number(invoice.data.total)).toBe(100);

    const wallet = await service.from("customer_wallets").insert({
      company_id: companyId,
      customer_id: customerId,
      balance_cents: 15000,
      chargeback_debt_cents: 0,
    });
    expect(wallet.error, wallet.error?.message).toBeNull();

    const signed = await auth.auth.signInWithPassword({ email, password });
    expect(signed.error, signed.error?.message).toBeNull();
    const token = signed.data.session?.access_token || "";
    expect(token).not.toBe("");

    const paid = await json(await request.post(`${appUrl}/api/stripe/wallet/pay-invoice`, {
      headers: { authorization: `Bearer ${token}` },
      data: { invoiceId },
    }), "Wallet invoice payment");
    expect(paid.paid).toBe(true);
    expect(paid.duplicate).toBe(false);
    expect(paid.balanceCredits).toBe(50);
    paymentId = String(paid.paymentId || "");
    expect(paymentId).not.toBe("");

    const replay = await json(await request.post(`${appUrl}/api/stripe/wallet/pay-invoice`, {
      headers: { authorization: `Bearer ${token}` },
      data: { invoiceId },
    }), "Wallet invoice replay");
    expect(replay.paid).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(replay.balanceCredits).toBe(50);

    const walletAfter = await service.from("customer_wallets")
      .select("balance_cents")
      .eq("customer_id", customerId)
      .single();
    expect(walletAfter.error, walletAfter.error?.message).toBeNull();
    expect(walletAfter.data.balance_cents).toBe(5000);

    const transactions = await service.from("customer_wallet_transactions")
      .select("id")
      .eq("customer_id", customerId)
      .eq("transaction_type", "service")
      .eq("reference_id", invoiceId);
    expect(transactions.error, transactions.error?.message).toBeNull();
    expect(transactions.data || []).toHaveLength(1);

    const payments = await service.from("payments")
      .select("id,method,status")
      .eq("invoice_id", invoiceId)
      .eq("method", "account_balance");
    expect(payments.error, payments.error?.message).toBeNull();
    expect(payments.data || []).toHaveLength(1);
    expect(payments.data?.[0]?.status).toBe("paid");

    const payout = await service.from("company_payout_items")
      .select("id,visit_id,transfer_amount,platform_fee,status")
      .eq("payment_id", paymentId)
      .single();
    expect(payout.error, payout.error?.message).toBeNull();
    payoutId = payout.data.id;
    expect(payout.data.visit_id).toBe(visitId);
    expect(Number(payout.data.transfer_amount)).toBe(75);
    expect(Number(payout.data.platform_fee)).toBe(25);
    expect(payout.data.status).toBe("eligible");

    const charged = await service.from("visit_billing_events")
      .select("state")
      .eq("id", eventId)
      .single();
    expect(charged.error, charged.error?.message).toBeNull();
    expect(charged.data.state).toBe("charged");
  } finally {
    if (payoutId) await service.from("company_payout_items").delete().eq("id", payoutId);
    if (paymentId) await service.from("payments").delete().eq("id", paymentId);
    await service.from("customer_wallet_transactions").delete().eq("customer_id", customerId);
    await service.from("customer_wallets").delete().eq("customer_id", customerId);
    if (invoiceId) await service.from("invoices").delete().eq("id", invoiceId);
    if (eventId) await service.from("visit_billing_events").delete().eq("id", eventId);
    await service.from("feedback").delete().eq("customer_id", customerId);
    if (visitId) await service.from("visits").delete().eq("id", visitId);
    await service.from("billing_agreements").delete().eq("id", agreementId);
    await service.from("jobs").delete().eq("id", jobId);
    await service.from("properties").delete().eq("id", propertyId);
    await service.from("customers").delete().eq("id", customerId);
    if (profileId) {
      await service.from("profiles").delete().eq("id", profileId);
      await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    }
    await service.from("organizations").delete().eq("id", companyId);
  }
});
