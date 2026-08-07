import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function required(name: string, value?: string) {
  if (!value) throw new Error(`Missing required E2E secret: ${name}`);
  return value;
}

async function jsonText(response: { text(): Promise<string> }) {
  const text = await response.text();
  return { text, body: text ? JSON.parse(text) : {} };
}

test("Master -> Company -> Admin -> Customer -> Property -> Quote -> Job -> Employee", async ({ request }) => {
  required("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  required("SUPABASE_SERVICE_ROLE_KEY", serviceKey);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeStamp = stamp.replace(/[^a-z0-9]/gi, "");
  const masterEmail = `qa-master-${stamp}@example.com`;
  const masterPassword = `QaMaster!${safeStamp}Aa1`;
  const adminEmail = `damasio.qa.admin.${safeStamp}@gmail.com`;
  const adminSeedPassword = `QaAdmin!${safeStamp}Aa1`;
  const employeeEmail = `damasio.qa.employee.${safeStamp}@gmail.com`;
  const companyName = `QA Ecosystem ${stamp}`;
  const slug = `qa-ecosystem-${stamp}`.toLowerCase();

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const masterAuth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminAuth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let masterUserId = "";
  let adminUserId = "";
  let employeeUserId = "";
  let companyId = "";
  let customerId = "";
  let propertyId = "";
  let quoteId = "";
  let jobId = "";

  try {
    const createdMaster = await service.auth.admin.createUser({
      email: masterEmail,
      password: masterPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Master" },
    });
    expect(createdMaster.error, createdMaster.error?.message).toBeNull();
    masterUserId = createdMaster.data.user?.id || "";
    expect(masterUserId).not.toBe("");

    const masterProfileWrite = await service.from("profiles").upsert({
      id: masterUserId,
      role: "master",
      full_name: "QA Master",
      email: masterEmail,
      active: true,
    });
    expect(masterProfileWrite.error, masterProfileWrite.error?.message).toBeNull();

    // Seed the Auth identity without sending email. The real Master endpoint must discover
    // and link this existing user to the newly-created company.
    const seededAdmin = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminSeedPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Company Admin" },
    });
    expect(seededAdmin.error, seededAdmin.error?.message).toBeNull();
    adminUserId = seededAdmin.data.user?.id || "";
    expect(adminUserId).not.toBe("");

    const signedMaster = await masterAuth.auth.signInWithPassword({ email: masterEmail, password: masterPassword });
    expect(signedMaster.error, signedMaster.error?.message).toBeNull();
    const masterToken = signedMaster.data.session?.access_token;
    expect(masterToken).toBeTruthy();

    const companyResponse = await request.post(`${appUrl}/api/master/companies`, {
      headers: { authorization: `Bearer ${masterToken}` },
      data: {
        name: companyName,
        slug,
        plan: "professional",
        adminName: "QA Company Admin",
        adminEmail,
      },
    });
    const companyResult = await jsonText(companyResponse);
    expect(companyResponse.ok(), `Master company creation failed: HTTP ${companyResponse.status()} ${companyResult.text}`).toBeTruthy();
    companyId = companyResult.body.company?.id || companyResult.body.id || "";
    expect(companyId, `Company id missing from response: ${companyResult.text}`).not.toBe("");

    const companyRead = await service.from("organizations").select("id,name,slug,contact_email").eq("id", companyId).maybeSingle();
    expect(companyRead.error, companyRead.error?.message).toBeNull();
    expect(companyRead.data?.name).toBe(companyName);
    expect(companyRead.data?.contact_email).toBe(adminEmail);

    const adminProfile = await service.from("profiles").select("id,email,role,organization_id,company_id,active").eq("id", adminUserId).maybeSingle();
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();
    expect(adminProfile.data?.role).toBe("admin");
    expect(adminProfile.data?.active).toBe(true);
    expect(adminProfile.data?.organization_id || adminProfile.data?.company_id).toBe(companyId);

    // linkExistingAdmin may replace the seed password when email delivery is rate-limited.
    const adminPassword = companyResult.body.temporaryPassword || adminSeedPassword;
    const signedAdmin = await adminAuth.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    expect(signedAdmin.error, `Admin login failed after Master company creation: ${signedAdmin.error?.message}`).toBeNull();
    const adminToken = signedAdmin.data.session?.access_token;
    expect(adminToken).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "master-company-admin", companyId, adminUserId }));

    const customerResponse = await request.post(`${appUrl}/api/admin/customers`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: {
        fullName: "QA Ecosystem Customer",
        phone: "9055550101",
        customerNotes: "Full ecosystem E2E customer",
        addressLine1: "100 Main St W",
        city: "Hamilton",
        province: "ON",
        postalCode: "L8P 1H6",
        lotSize: "small",
        grassHeight: "3in",
        gate: true,
        dog: false,
        irrigation: true,
        accessNotes: "Use side gate",
        propertyNotes: "QA property",
        serviceName: "Lawn Cutting",
        frequency: "weekly",
        subtotal: 49,
      },
    });
    const customerResult = await jsonText(customerResponse);
    expect(customerResponse.ok(), `Canonical customer chain failed: HTTP ${customerResponse.status()} ${customerResult.text}`).toBeTruthy();
    customerId = customerResult.body.customerId || "";
    propertyId = customerResult.body.propertyId || "";
    quoteId = customerResult.body.quoteId || "";
    jobId = customerResult.body.jobId || "";
    expect(customerId).not.toBe("");
    expect(propertyId).not.toBe("");
    expect(quoteId).not.toBe("");
    expect(jobId).not.toBe("");

    const [customerDb, propertyDb, quoteDb, jobDb] = await Promise.all([
      service.from("customers").select("id,company_id,service_company_id,full_name").eq("id", customerId).single(),
      service.from("properties").select("id,company_id,customer_id,address_line1").eq("id", propertyId).single(),
      service.from("quotes").select("id,company_id,customer_id,property_id,status,total").eq("id", quoteId).single(),
      service.from("jobs").select("id,company_id,customer_id,property_id,quote_id,active").eq("id", jobId).single(),
    ]);
    expect(customerDb.error, customerDb.error?.message).toBeNull();
    expect(propertyDb.error, propertyDb.error?.message).toBeNull();
    expect(quoteDb.error, quoteDb.error?.message).toBeNull();
    expect(jobDb.error, jobDb.error?.message).toBeNull();
    expect(customerDb.data?.service_company_id || customerDb.data?.company_id).toBe(companyId);
    expect(propertyDb.data?.customer_id).toBe(customerId);
    expect(quoteDb.data?.property_id).toBe(propertyId);
    expect(quoteDb.data?.status).toBe("approved");
    expect(jobDb.data?.quote_id).toBe(quoteId);
    expect(jobDb.data?.active).toBe(true);

    const directoryResponse = await request.get(`${appUrl}/api/admin/customers`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const directoryResult = await jsonText(directoryResponse);
    expect(directoryResponse.ok(), `Admin customer directory failed: ${directoryResult.text}`).toBeTruthy();
    expect(directoryResult.body.records?.some((row: any) => row.customerId === customerId && row.propertyId === propertyId)).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "customer-property-quote-job", customerId, propertyId, quoteId, jobId }));

    const employeeResponse = await request.post(`${appUrl}/api/admin/users`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: {
        fullName: "QA Route Worker",
        email: employeeEmail,
        phone: "9055550102",
        addressLine1: "200 King St E",
        city: "Hamilton",
        province: "ON",
        postalCode: "L8N 1B5",
        routeStartAddress: "200 King St E, Hamilton, ON",
        dailyRouteCapacity: 25,
        active: true,
      },
    });
    const employeeResult = await jsonText(employeeResponse);
    expect(employeeResponse.ok(), `Admin employee creation failed: HTTP ${employeeResponse.status()} ${employeeResult.text}`).toBeTruthy();
    employeeUserId = employeeResult.body.user?.id || "";
    expect(employeeUserId).not.toBe("");

    const employeeProfile = await service.from("profiles").select("id,company_id,organization_id,role,active").eq("id", employeeUserId).single();
    expect(employeeProfile.error, employeeProfile.error?.message).toBeNull();
    expect(employeeProfile.data?.role).toBe("employee");
    expect(employeeProfile.data?.company_id || employeeProfile.data?.organization_id).toBe(companyId);
    expect(employeeProfile.data?.active).toBe(true);
    console.log(JSON.stringify({ checkpoint: "employee-created", employeeUserId }));
  } finally {
    if (employeeUserId) {
      await service.from("employees").delete().eq("profile_id", employeeUserId);
      await service.from("profiles").delete().eq("id", employeeUserId);
      await service.auth.admin.deleteUser(employeeUserId).catch(() => undefined);
    }
    if (jobId) await service.from("jobs").delete().eq("id", jobId);
    if (quoteId) await service.from("quotes").delete().eq("id", quoteId);
    if (propertyId) await service.from("properties").delete().eq("id", propertyId);
    if (customerId) await service.from("customers").delete().eq("id", customerId);
    if (adminUserId) {
      await service.from("profiles").delete().eq("id", adminUserId);
      await service.auth.admin.deleteUser(adminUserId).catch(() => undefined);
    }
    if (companyId) await service.from("organizations").delete().eq("id", companyId);
    if (masterUserId) {
      await service.from("profiles").delete().eq("id", masterUserId);
      await service.auth.admin.deleteUser(masterUserId).catch(() => undefined);
    }
  }
});
