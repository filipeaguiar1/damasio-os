import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function client(key: string) {
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function signIn(email: string, password: string) {
  const db = client(anonKey);
  const signed = await db.auth.signInWithPassword({ email, password });
  expect(signed.error, signed.error?.message).toBeNull();
  expect(signed.data.session?.access_token).toBeTruthy();
  return db;
}

test("canonical quote acceptance → Visit billing → exact payout is ordered and idempotent", async () => {
  test.setTimeout(180_000);
  expect(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();
  expect(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();

  const service = client(serviceKey);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyId = randomUUID();
  const customerId = randomUUID();
  const propertyId = randomUUID();
  const adminEmail = `business.admin.${suffix}@4everseasons.test`;
  const customerEmail = `business.customer.${suffix}@4everseasons.test`;
  const adminPassword = `QaAdmin!${suffix}Aa1`;
  const customerPassword = `QaCustomer!${suffix}Aa1`;
  let adminUserId = "";
  let customerUserId = "";
  let requestId = "";
  let quoteId = "";
  let leadId = "";
  let jobId = "";
  let agreementId = "";
  let visitId = "";
  let eventId = "";
  let taskId = "";
  let invoiceId = "";
  let paymentId = "";
  let payoutId = "";

  try {
    const organization = await service.from("organizations").insert({
      id: companyId,
      name: `QA Business Lifecycle ${suffix}`,
      slug: `qa-business-lifecycle-${suffix}`.toLowerCase(),
      active: true,
      plan_name: "professional",
      contact_email: adminEmail,
    });
    expect(organization.error, organization.error?.message).toBeNull();

    const adminAuth = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Business Admin" },
    });
    expect(adminAuth.error, adminAuth.error?.message).toBeNull();
    adminUserId = adminAuth.data.user?.id || "";
    expect(adminUserId).not.toBe("");

    const customerAuth = await service.auth.admin.createUser({
      email: customerEmail,
      password: customerPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Business Customer" },
    });
    expect(customerAuth.error, customerAuth.error?.message).toBeNull();
    customerUserId = customerAuth.data.user?.id || "";
    expect(customerUserId).not.toBe("");

    const adminProfile = await service.from("profiles").upsert({
      id: adminUserId,
      organization_id: companyId,
      company_id: companyId,
      role: "admin",
      full_name: "QA Business Admin",
      email: adminEmail,
      active: true,
    });
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();

    const customerProfile = await service.from("profiles").upsert({
      id: customerUserId,
      organization_id: companyId,
      company_id: companyId,
      role: "customer",
      full_name: "QA Business Customer",
      email: customerEmail,
      active: true,
    });
    expect(customerProfile.error, customerProfile.error?.message).toBeNull();

    const customer = await service.from("customers").insert({
      id: customerId,
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      profile_id: customerUserId,
      full_name: "QA Business Customer",
      email: customerEmail,
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
      address_line1: "86 Canonical Business Way",
      city: "Hamilton",
      province: "ON",
      country: "Canada",
    });
    expect(property.error, property.error?.message).toBeNull();

    const request = await service.from("service_requests").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      service_name: "Weekly Lawn Care",
      status: "quoted",
    }).select("id").single();
    expect(request.error, request.error?.message).toBeNull();
    requestId = request.data.id;

    const quote = await service.from("quotes").insert({
      organization_id: companyId,
      company_id: companyId,
      request_id: requestId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: `QA-BIZ-${suffix}`,
      status: "sent",
      subtotal: 88.5,
      tax: 11.5,
      total: 100,
      customer_email: customerEmail,
      acquisition_source: "platform",
      master_reviewed_at: new Date().toISOString(),
    }).select("id").single();
    expect(quote.error, quote.error?.message).toBeNull();
    quoteId = quote.data.id;

    const lead = await service.from("lead_center").insert({
      assigned_company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      service_request_id: requestId,
      quote_id: quoteId,
      full_name: "QA Business Customer",
      email: customerEmail,
      address: "86 Canonical Business Way",
      service_requested: "Weekly Lawn Care",
      status: "offered",
      final_total: 100,
    }).select("id").single();
    expect(lead.error, lead.error?.message).toBeNull();
    leadId = lead.data.id;

    const customerDb = await signIn(customerEmail, customerPassword);
    const premature = await customerDb.rpc("customer_decide_quote", {
      p_quote_id: quoteId,
      p_approve: true,
    });
    expect(premature.error).toBeTruthy();
    expect(String(premature.error?.message || "")).toContain("service company must accept");

    const jobsBefore = await service.from("jobs").select("id").eq("quote_id", quoteId);
    expect(jobsBefore.error, jobsBefore.error?.message).toBeNull();
    expect(jobsBefore.data || []).toHaveLength(0);

    const adminDb = await signIn(adminEmail, adminPassword);
    const accepted = await adminDb.rpc("respond_company_referral", {
      p_lead_id: leadId,
      p_accept: true,
    });
    expect(accepted.error, accepted.error?.message).toBeNull();

    const jobsAfterCompany = await service.from("jobs").select("id").eq("quote_id", quoteId);
    expect(jobsAfterCompany.error, jobsAfterCompany.error?.message).toBeNull();
    expect(jobsAfterCompany.data || []).toHaveLength(0);

    const approved = await customerDb.rpc("customer_decide_quote", {
      p_quote_id: quoteId,
      p_approve: true,
    });
    expect(approved.error, approved.error?.message).toBeNull();
    jobId = String(approved.data?.job_id || "");
    expect(jobId).not.toBe("");

    const duplicateApproval = await customerDb.rpc("customer_decide_quote", {
      p_quote_id: quoteId,
      p_approve: true,
    });
    expect(duplicateApproval.error, duplicateApproval.error?.message).toBeNull();
    expect(duplicateApproval.data?.duplicate).toBe(true);

    const jobsAfterCustomer = await service.from("jobs").select("id").eq("quote_id", quoteId);
    expect(jobsAfterCustomer.error, jobsAfterCustomer.error?.message).toBeNull();
    expect(jobsAfterCustomer.data || []).toHaveLength(1);

    const agreement = await service.from("billing_agreements").insert({
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_id: quoteId,
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
    }).select("id").single();
    expect(agreement.error, agreement.error?.message).toBeNull();
    agreementId = agreement.data.id;

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

    const event = await service.from("visit_billing_events")
      .select("id,state")
      .eq("visit_id", visitId)
      .single();
    expect(event.error, event.error?.message).toBeNull();
    eventId = event.data.id;
    expect(event.data.state).toBe("awaiting_feedback");

    const lowFeedback = await service.from("feedback").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      visit_id: visitId,
      rating: 2,
      comment: null,
    });
    expect(lowFeedback.error, lowFeedback.error?.message).toBeNull();

    const held = await service.from("visit_billing_events")
      .select("state,active_task_id")
      .eq("id", eventId)
      .single();
    expect(held.error, held.error?.message).toBeNull();
    expect(held.data.state).toBe("task_hold");
    taskId = String(held.data.active_task_id || "");
    expect(taskId).not.toBe("");

    const resolved = await service.from("tasks").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
    }).eq("id", taskId);
    expect(resolved.error, resolved.error?.message).toBeNull();

    const positiveFeedback = await service.from("feedback").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      task_id: taskId,
      rating: 5,
      comment: "Resolved well",
    });
    expect(positiveFeedback.error, positiveFeedback.error?.message).toBeNull();

    const released = await service.from("visit_billing_events")
      .select("state")
      .eq("id", eventId)
      .single();
    expect(released.error, released.error?.message).toBeNull();
    expect(released.data.state).toBe("release_pending");

    const invoice = await service.from("invoices")
      .select("id,total,subtotal,tax,visit_id,billing_event_id")
      .eq("billing_event_id", eventId)
      .single();
    expect(invoice.error, invoice.error?.message).toBeNull();
    invoiceId = invoice.data.id;
    expect(Number(invoice.data.total)).toBe(100);
    expect(Number(invoice.data.subtotal)).toBe(88.5);
    expect(Number(invoice.data.tax)).toBe(11.5);
    expect(invoice.data.visit_id).toBe(visitId);

    const paymentIntent = `pi_test_business_${suffix}`;
    const chargeId = `ch_test_business_${suffix}`;
    const payment = await service.from("payments").insert({
      organization_id: companyId,
      company_id: companyId,
      invoice_id: invoiceId,
      customer_id: customerId,
      method: "credit_card",
      status: "paid",
      amount: 100,
      reference: paymentIntent,
      stripe_payment_intent_id: paymentIntent,
      stripe_charge_id: chargeId,
      stripe_transfer_group: `business-${suffix}`,
      paid_at: new Date().toISOString(),
    }).select("id").single();
    expect(payment.error, payment.error?.message).toBeNull();
    paymentId = payment.data.id;

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

    const transferred = await service.from("company_payout_items").update({
      status: "transferred",
      stripe_transfer_id: `tr_test_business_${suffix}`,
      transferred_at: new Date().toISOString(),
    }).eq("id", payoutId);
    expect(transferred.error, transferred.error?.message).toBeNull();

    const finalEvent = await service.from("visit_billing_events")
      .select("state,stripe_transfer_id")
      .eq("id", eventId)
      .single();
    expect(finalEvent.error, finalEvent.error?.message).toBeNull();
    expect(finalEvent.data.state).toBe("transferred");
    expect(String(finalEvent.data.stripe_transfer_id || "")).toContain("tr_test_business_");

    console.log(JSON.stringify({
      checkpoint: "canonical-business-lifecycle",
      quoteId,
      jobId,
      visitId,
      eventId,
      invoiceId,
      payoutId,
    }));
  } finally {
    if (leadId) await service.from("master_audit_log").delete().eq("entity_type", "lead_center").eq("entity_id", leadId);
    if (quoteId) await service.from("activity_log").delete().eq("entity_type", "quote").eq("entity_id", quoteId);
    if (jobId) await service.from("activity_log").delete().eq("entity_type", "job").eq("entity_id", jobId);
    if (payoutId) await service.from("company_payout_items").delete().eq("id", payoutId);
    if (paymentId) await service.from("payments").delete().eq("id", paymentId);
    if (invoiceId) await service.from("invoices").delete().eq("id", invoiceId);
    if (eventId) await service.from("visit_billing_events").delete().eq("id", eventId);
    await service.from("feedback").delete().eq("customer_id", customerId);
    await service.from("tasks").delete().eq("customer_id", customerId);
    if (visitId) await service.from("visits").delete().eq("id", visitId);
    if (agreementId) await service.from("billing_agreements").delete().eq("id", agreementId);
    if (jobId) await service.from("jobs").delete().eq("id", jobId);
    if (leadId) await service.from("lead_center").delete().eq("id", leadId);
    if (quoteId) await service.from("quotes").delete().eq("id", quoteId);
    if (requestId) await service.from("service_requests").delete().eq("id", requestId);
    await service.from("properties").delete().eq("id", propertyId);
    await service.from("customers").delete().eq("id", customerId);
    if (customerUserId) {
      await service.from("profiles").delete().eq("id", customerUserId);
      await service.auth.admin.deleteUser(customerUserId).catch(() => undefined);
    }
    if (adminUserId) {
      await service.from("profiles").delete().eq("id", adminUserId);
      await service.auth.admin.deleteUser(adminUserId).catch(() => undefined);
    }
    await service.from("organizations").delete().eq("id", companyId);
  }
});
