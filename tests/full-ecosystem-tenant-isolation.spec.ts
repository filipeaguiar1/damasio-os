import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function authClient() {
  return createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function responseBody(response: any) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

test("company and customer APIs reject cross-tenant access", async ({ request }) => {
  test.setTimeout(180_000);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyA = randomUUID();
  const companyB = randomUUID();
  const adminAEmail = `tenant.a.admin.${suffix}@4everseasons.test`;
  const adminBEmail = `tenant.b.admin.${suffix}@4everseasons.test`;
  const customerBEmail = `tenant.b.customer.${suffix}@4everseasons.test`;
  const password = `QaTenant!${suffix}Aa1`;
  let adminAId = "";
  let adminBId = "";
  let customerBProfileId = "";
  const customerAId = randomUUID();
  const propertyAId = randomUUID();
  const customerBId = randomUUID();
  const propertyBId = randomUUID();
  const visitAId = randomUUID();

  try {
    for (const [id, name, slug, email] of [
      [companyA, "QA Tenant A", `qa-tenant-a-${suffix}`, adminAEmail],
      [companyB, "QA Tenant B", `qa-tenant-b-${suffix}`, adminBEmail],
    ]) {
      const result = await service.from("organizations").insert({ id, name, slug, active: true, plan_name: "professional", contact_email: email });
      expect(result.error, result.error?.message).toBeNull();
    }

    async function makeUser(email: string, role: "admin" | "customer", companyId: string, customerId?: string) {
      const created = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: `QA ${role}`, role, company_id: companyId, customer_id: customerId },
      });
      expect(created.error, created.error?.message).toBeNull();
      const id = created.data.user?.id || "";
      const profile = await service.from("profiles").upsert({
        id, organization_id: companyId, company_id: companyId, role,
        full_name: `QA ${role}`, email, active: true,
      });
      expect(profile.error, profile.error?.message).toBeNull();
      return id;
    }

    adminAId = await makeUser(adminAEmail, "admin", companyA);
    adminBId = await makeUser(adminBEmail, "admin", companyB);
    customerBProfileId = await makeUser(customerBEmail, "customer", companyB, customerBId);

    const rows = [
      { companyId: companyA, customerId: customerAId, propertyId: propertyAId, name: "Tenant A Customer", email: null, profileId: null },
      { companyId: companyB, customerId: customerBId, propertyId: propertyBId, name: "Tenant B Customer", email: customerBEmail, profileId: customerBProfileId },
    ];
    for (const row of rows) {
      const customer = await service.from("customers").insert({
        id: row.customerId, organization_id: row.companyId, company_id: row.companyId,
        service_company_id: row.companyId, profile_id: row.profileId,
        full_name: row.name, email: row.email,
        acquisition_source: "company_created", assignment_status: "active",
        offer_status: "accepted", platform_managed: false,
      });
      expect(customer.error, customer.error?.message).toBeNull();
      const property = await service.from("properties").insert({
        id: row.propertyId, organization_id: row.companyId, company_id: row.companyId,
        customer_id: row.customerId, address_line1: row.name,
        city: "Hamilton", province: "ON", postal_code: "L8P 1H6", country: "Canada",
      });
      expect(property.error, property.error?.message).toBeNull();
    }

    const visitA = await service.from("visits").insert({
      id: visitAId, organization_id: companyA, company_id: companyA,
      customer_id: customerAId, property_id: propertyAId,
      scheduled_date: new Date().toISOString().slice(0, 10),
      status: "completed", started_at: new Date(Date.now() - 60000).toISOString(),
      finished_at: new Date().toISOString(), duration_seconds: 60,
    });
    expect(visitA.error, visitA.error?.message).toBeNull();

    const aClient = authClient();
    const aSession = await aClient.auth.signInWithPassword({ email: adminAEmail, password });
    expect(aSession.error, aSession.error?.message).toBeNull();
    const aToken = aSession.data.session?.access_token;

    const bClient = authClient();
    const bSession = await bClient.auth.signInWithPassword({ email: adminBEmail, password });
    expect(bSession.error, bSession.error?.message).toBeNull();
    const bToken = bSession.data.session?.access_token;

    const customerClient = authClient();
    const customerSession = await customerClient.auth.signInWithPassword({ email: customerBEmail, password });
    expect(customerSession.error, customerSession.error?.message).toBeNull();
    const customerBToken = customerSession.data.session?.access_token;

    const directoryA = await request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${aToken}` } });
    const directoryABody = await responseBody(directoryA);
    expect(directoryA.ok(), JSON.stringify(directoryABody)).toBeTruthy();
    expect(directoryABody.records?.some((row: any) => row.customerId === customerAId)).toBeTruthy();
    expect(directoryABody.records?.some((row: any) => row.customerId === customerBId)).toBeFalsy();

    const directoryB = await request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${bToken}` } });
    const directoryBBody = await responseBody(directoryB);
    expect(directoryB.ok(), JSON.stringify(directoryBBody)).toBeTruthy();
    expect(directoryBBody.records?.some((row: any) => row.customerId === customerBId)).toBeTruthy();
    expect(directoryBBody.records?.some((row: any) => row.customerId === customerAId)).toBeFalsy();

    const crossAdminRead = await request.get(`${appUrl}/api/admin/customers/${customerBId}`, {
      headers: { authorization: `Bearer ${aToken}` },
    });
    expect(crossAdminRead.ok()).toBeFalsy();

    const crossCustomerFeedback = await request.post(`${appUrl}/api/customer/portal-actions`, {
      headers: { authorization: `Bearer ${customerBToken}` },
      data: { action: "feedback", visitId: visitAId, rating: 1, comment: "Must be rejected across tenant boundary" },
    });
    expect(crossCustomerFeedback.ok()).toBeFalsy();
    expect([400, 403]).toContain(crossCustomerFeedback.status());

    const leakedFeedback = await service.from("feedback").select("id").eq("visit_id", visitAId);
    expect(leakedFeedback.error, leakedFeedback.error?.message).toBeNull();
    expect(leakedFeedback.data || []).toHaveLength(0);

    console.log(JSON.stringify({ checkpoint: "tenant-isolation", companyA, companyB, crossAdminStatus: crossAdminRead.status(), crossCustomerStatus: crossCustomerFeedback.status() }));
  } finally {
    await service.from("feedback").delete().eq("visit_id", visitAId);
    await service.from("visits").delete().eq("id", visitAId);
    await service.from("properties").delete().in("id", [propertyAId, propertyBId]);
    await service.from("customers").delete().in("id", [customerAId, customerBId]);
    await Promise.all([customerBProfileId, adminBId, adminAId].filter(Boolean).map(async id => {
      await service.from("profiles").delete().eq("id", id);
      await service.auth.admin.deleteUser(id).catch(() => undefined);
    }));
    await service.from("organizations").delete().in("id", [companyA, companyB]);
  }
});

test("platform Customer ownership moves only after offer acceptance", async ({ request }) => {
  test.setTimeout(180_000);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyA = randomUUID();
  const companyB = randomUUID();
  const customerId = randomUUID();
  const propertyId = randomUUID();
  const adminAEmail = `platform.owner.a.${suffix}@4everseasons.test`;
  const adminBEmail = `platform.owner.b.${suffix}@4everseasons.test`;
  const password = `QaPlatform!${suffix}Aa1`;
  let adminAId = "";
  let adminBId = "";

  async function makeAdmin(email: string, companyId: string) {
    const created = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: "QA Platform Admin", role: "admin", company_id: companyId },
    });
    expect(created.error, created.error?.message).toBeNull();
    const id = created.data.user?.id || "";
    const profile = await service.from("profiles").upsert({
      id, organization_id: companyId, company_id: companyId, role: "admin",
      full_name: "QA Platform Admin", email, active: true,
    });
    expect(profile.error, profile.error?.message).toBeNull();
    return id;
  }

  try {
    for (const [id, name, slug, email] of [
      [companyA, "QA Platform Owner A", `qa-platform-owner-a-${suffix}`, adminAEmail],
      [companyB, "QA Platform Owner B", `qa-platform-owner-b-${suffix}`, adminBEmail],
    ]) {
      const organization = await service.from("organizations").insert({ id, name, slug, active: true, plan_name: "professional", contact_email: email });
      expect(organization.error, organization.error?.message).toBeNull();
    }

    adminAId = await makeAdmin(adminAEmail, companyA);
    adminBId = await makeAdmin(adminBEmail, companyB);

    const customer = await service.from("customers").insert({
      id: customerId, organization_id: companyA, company_id: companyA, service_company_id: companyA,
      full_name: "QA Platform Customer", email: `platform.customer.${suffix}@4everseasons.test`,
      acquisition_source: "platform", platform_managed: true,
      assignment_status: "accepted", offer_status: "accepted",
      offered_service_price: 120, company_service_payout: 120, archived_at: null,
    });
    expect(customer.error, customer.error?.message).toBeNull();
    const property = await service.from("properties").insert({
      id: propertyId, organization_id: companyA, company_id: companyA, customer_id: customerId,
      address_line1: "100 Platform Ownership Test Rd", city: "Hamilton", province: "ON",
      postal_code: "L8P 1H6", country: "Canada", property_notes: "Property Service",
    });
    expect(property.error, property.error?.message).toBeNull();

    const aClient = authClient();
    const aSession = await aClient.auth.signInWithPassword({ email: adminAEmail, password });
    expect(aSession.error, aSession.error?.message).toBeNull();
    const aToken = aSession.data.session?.access_token || "";
    const bClient = authClient();
    const bSession = await bClient.auth.signInWithPassword({ email: adminBEmail, password });
    expect(bSession.error, bSession.error?.message).toBeNull();
    const bToken = bSession.data.session?.access_token || "";

    const acceptedDirectoryA = await request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${aToken}` } });
    const acceptedDirectoryABody = await responseBody(acceptedDirectoryA);
    expect(acceptedDirectoryA.ok(), JSON.stringify(acceptedDirectoryABody)).toBeTruthy();
    expect(acceptedDirectoryABody.records?.some((row: any) => row.customerId === customerId)).toBeTruthy();

    const rawAcceptedA = await aClient.from("customers").select("id").eq("id", customerId);
    expect(rawAcceptedA.error, rawAcceptedA.error?.message).toBeNull();
    expect(rawAcceptedA.data || []).toHaveLength(1);
    const forbiddenPlatformWrite = await aClient.from("customers").update({ notes: "blocked" }).eq("id", customerId).select("id");
    expect(forbiddenPlatformWrite.data || []).toHaveLength(0);

    const offer = await service.from("customers").update({
      previous_service_company_id: companyA, service_company_id: companyB,
      assignment_status: "offered", offer_status: "offered", offered_service_price: 135,
      company_service_payout: 135, offer_sent_at: new Date().toISOString(), offer_responded_at: null,
    }).eq("id", customerId);
    expect(offer.error, offer.error?.message).toBeNull();

    const [holdDirectoryA, offeredDirectoryB, offersB] = await Promise.all([
      request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${aToken}` } }),
      request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${bToken}` } }),
      request.get(`${appUrl}/api/admin/customer-offers`, { headers: { authorization: `Bearer ${bToken}` } }),
    ]);
    const holdDirectoryABody = await responseBody(holdDirectoryA);
    const offeredDirectoryBBody = await responseBody(offeredDirectoryB);
    const offersBBody = await responseBody(offersB);
    expect(holdDirectoryA.ok(), JSON.stringify(holdDirectoryABody)).toBeTruthy();
    expect(offeredDirectoryB.ok(), JSON.stringify(offeredDirectoryBBody)).toBeTruthy();
    expect(offersB.ok(), JSON.stringify(offersBBody)).toBeTruthy();
    expect(holdDirectoryABody.records?.some((row: any) => row.customerId === customerId)).toBeFalsy();
    expect(offeredDirectoryBBody.records?.some((row: any) => row.customerId === customerId)).toBeFalsy();
    expect(offersBBody.offers?.some((row: any) => row.id === customerId)).toBeTruthy();

    const rawHeldA = await aClient.from("customers").select("id").eq("id", customerId);
    const rawOfferedB = await bClient.from("customers").select("id").eq("id", customerId);
    expect(rawHeldA.error, rawHeldA.error?.message).toBeNull();
    expect(rawOfferedB.error, rawOfferedB.error?.message).toBeNull();
    expect(rawHeldA.data || []).toHaveLength(0);
    expect(rawOfferedB.data || []).toHaveLength(0);

    const accept = await request.post(`${appUrl}/api/admin/customers/${customerId}`, {
      headers: { authorization: `Bearer ${bToken}` },
      data: { action: "accept", note: "QA ownership acceptance" },
    });
    const acceptBody = await responseBody(accept);
    expect(accept.ok(), JSON.stringify(acceptBody)).toBeTruthy();
    expect(acceptBody.accepted).toBe(true);

    const afterDirectoryA = await request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${aToken}` } });
    const afterDirectoryB = await request.get(`${appUrl}/api/admin/customers`, { headers: { authorization: `Bearer ${bToken}` } });
    const afterDirectoryABody = await responseBody(afterDirectoryA);
    const afterDirectoryBBody = await responseBody(afterDirectoryB);
    expect(afterDirectoryA.ok(), JSON.stringify(afterDirectoryABody)).toBeTruthy();
    expect(afterDirectoryB.ok(), JSON.stringify(afterDirectoryBBody)).toBeTruthy();
    expect(afterDirectoryABody.records?.some((row: any) => row.customerId === customerId)).toBeFalsy();
    expect(afterDirectoryBBody.records?.some((row: any) => row.customerId === customerId)).toBeTruthy();

    const rawAcceptedB = await bClient.from("customers").select("id,service_company_id,offer_status,assignment_status").eq("id", customerId);
    expect(rawAcceptedB.error, rawAcceptedB.error?.message).toBeNull();
    expect(rawAcceptedB.data || []).toHaveLength(1);
    expect(rawAcceptedB.data?.[0]?.service_company_id).toBe(companyB);
    expect(rawAcceptedB.data?.[0]?.offer_status).toBe("accepted");

    console.log(JSON.stringify({ checkpoint: "platform-customer-ownership", companyA, companyB, customerId }));
  } finally {
    await service.from("activity_log").delete().eq("entity_id", customerId);
    await service.from("visits").delete().eq("customer_id", customerId);
    await service.from("tasks").delete().eq("customer_id", customerId);
    await service.from("jobs").delete().eq("customer_id", customerId);
    await service.from("service_requests").delete().eq("customer_id", customerId);
    await service.from("quotes").delete().eq("customer_id", customerId);
    await service.from("properties").delete().eq("id", propertyId);
    await service.from("customers").delete().eq("id", customerId);
    await Promise.all([adminBId, adminAId].filter(Boolean).map(async id => {
      await service.from("profiles").delete().eq("id", id);
      await service.auth.admin.deleteUser(id).catch(() => undefined);
    }));
    await service.from("organizations").delete().in("id", [companyA, companyB]);
  }
});
