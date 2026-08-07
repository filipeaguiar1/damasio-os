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
  test.setTimeout(90_000);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyA = randomUUID();
  const companyB = randomUUID();
  const adminAEmail = `tenant.a.admin.${suffix}@example.com`;
  const adminBEmail = `tenant.b.admin.${suffix}@example.com`;
  const customerBEmail = `tenant.b.customer.${suffix}@example.com`;
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
      service_name: "Tenant isolation service", scheduled_date: new Date().toISOString().slice(0, 10),
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
    for (const id of [customerBProfileId, adminBId, adminAId].filter(Boolean)) {
      await service.from("profiles").delete().eq("id", id);
      await service.auth.admin.deleteUser(id).catch(() => undefined);
    }
    await service.from("organizations").delete().in("id", [companyA, companyB]);
  }
});
