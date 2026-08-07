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

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

test("Master -> Company -> Admin -> Customer -> Property -> Quote -> Job -> Route -> Employee Start/Reopen/Done", async ({ request }) => {
  test.setTimeout(120_000);
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
  const employeePassword = `QaEmployee!${safeStamp}Aa1`;
  const companyName = `QA Ecosystem ${stamp}`;
  const slug = `qa-ecosystem-${stamp}`.toLowerCase();
  const routeDate = torontoDateKey();

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const masterAuth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminAuth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let masterUserId = "";
  let adminUserId = "";
  let employeeUserId = "";
  let employeeRecordId = "";
  let crewId = "";
  let companyId = "";
  let customerId = "";
  let propertyId = "";
  let quoteId = "";
  let jobId = "";
  let visitId = "";
  let routeId = "";

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
    expect(companyId).not.toBe("");

    const adminProfile = await service.from("profiles").select("id,email,role,organization_id,company_id,active").eq("id", adminUserId).maybeSingle();
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();
    expect(adminProfile.data?.role).toBe("admin");
    expect(adminProfile.data?.active).toBe(true);
    expect(adminProfile.data?.organization_id || adminProfile.data?.company_id).toBe(companyId);

    const adminPassword = companyResult.body.temporaryPassword || adminSeedPassword;
    const signedAdmin = await adminAuth.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    expect(signedAdmin.error, signedAdmin.error?.message).toBeNull();
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
    expect(customerResponse.ok(), `Canonical customer chain failed: ${customerResult.text}`).toBeTruthy();
    customerId = customerResult.body.customerId || "";
    propertyId = customerResult.body.propertyId || "";
    quoteId = customerResult.body.quoteId || "";
    jobId = customerResult.body.jobId || "";
    for (const value of [customerId, propertyId, quoteId, jobId]) expect(value).not.toBe("");

    const directoryResponse = await request.get(`${appUrl}/api/admin/customers`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const directoryResult = await jsonText(directoryResponse);
    expect(directoryResponse.ok(), directoryResult.text).toBeTruthy();
    expect(directoryResult.body.records?.some((row: any) => row.customerId === customerId && row.propertyId === propertyId)).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "customer-property-quote-job", customerId, propertyId, quoteId, jobId }));

    // Employee identity is seeded without email delivery so provider rate limits cannot block
    // the operational ecosystem. Company ownership and every canonical Employee/Crew row are
    // still verified through the same database consumed by Admin and Employee routes.
    const employeeAuth = await service.auth.admin.createUser({
      email: employeeEmail,
      password: employeePassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Route Worker", role: "employee", company_id: companyId },
    });
    expect(employeeAuth.error, employeeAuth.error?.message).toBeNull();
    employeeUserId = employeeAuth.data.user?.id || "";
    expect(employeeUserId).not.toBe("");

    const employeeProfileWrite = await service.from("profiles").upsert({
      id: employeeUserId,
      organization_id: companyId,
      company_id: companyId,
      role: "employee",
      full_name: "QA Route Worker",
      email: employeeEmail,
      phone: "9055550102",
      address_line1: "200 King St E",
      city: "Hamilton",
      province: "ON",
      postal_code: "L8N 1B5",
      route_start_address: "200 King St E, Hamilton, ON",
      active: true,
      invite_status: "accepted",
    });
    expect(employeeProfileWrite.error, employeeProfileWrite.error?.message).toBeNull();

    const crewWrite = await service.from("crews").insert({
      organization_id: companyId,
      company_id: companyId,
      name: "QA Route Worker",
      active: true,
    }).select("id").single();
    expect(crewWrite.error, crewWrite.error?.message).toBeNull();
    crewId = crewWrite.data?.id || "";
    expect(crewId).not.toBe("");

    const employeeWrite = await service.from("employees").insert({
      organization_id: companyId,
      company_id: companyId,
      profile_id: employeeUserId,
      crew_id: crewId,
      full_name: "QA Route Worker",
      email: employeeEmail,
      phone: "9055550102",
      address_line1: "200 King St E",
      city: "Hamilton",
      province: "ON",
      postal_code: "L8N 1B5",
      route_start_address: "200 King St E, Hamilton, ON",
      active: true,
      invite_status: "accepted",
    }).select("id").single();
    expect(employeeWrite.error, employeeWrite.error?.message).toBeNull();
    employeeRecordId = employeeWrite.data?.id || "";
    expect(employeeRecordId).not.toBe("");

    const routeBoardResponse = await request.get(`${appUrl}/api/admin/routes?date=${routeDate}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const routeBoard = await jsonText(routeBoardResponse);
    expect(routeBoardResponse.ok(), `Admin Route board failed: ${routeBoard.text}`).toBeTruthy();
    const boardEmployee = routeBoard.body.employees?.find((row: any) => row.employeeId === employeeRecordId);
    expect(boardEmployee?.crewId).toBe(crewId);
    expect(routeBoard.body.board?.unscheduledJobs?.some((row: any) => row.id === jobId)).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "employee-visible-to-admin-route", employeeRecordId, crewId }));

    const publishResponse = await request.post(`${appUrl}/api/admin/routes`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: {
        action: "smart",
        jobIds: [jobId],
        employeeId: employeeRecordId,
        crewId,
        routeDate,
      },
    });
    const publishResult = await jsonText(publishResponse);
    expect(publishResponse.ok(), `Admin canonical route publish failed: HTTP ${publishResponse.status()} ${publishResult.text}`).toBeTruthy();

    const visitRead = await service.from("visits")
      .select("id,route_id,route_order,status,scheduled_date,assigned_employee_id,crew_id,job_id,customer_id,property_id")
      .eq("job_id", jobId)
      .eq("scheduled_date", routeDate)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(visitRead.error, visitRead.error?.message).toBeNull();
    visitId = visitRead.data?.id || "";
    routeId = visitRead.data?.route_id || "";
    expect(visitId).not.toBe("");
    expect(routeId).not.toBe("");
    expect(visitRead.data?.route_order).toBe(1);
    expect(visitRead.data?.status).toBe("scheduled");
    expect(visitRead.data?.assigned_employee_id).toBe(employeeRecordId);
    expect(visitRead.data?.crew_id).toBe(crewId);
    expect(visitRead.data?.customer_id).toBe(customerId);
    expect(visitRead.data?.property_id).toBe(propertyId);
    console.log(JSON.stringify({ checkpoint: "schedule-dispatch-route", routeId, visitId, routeDate }));

    const employeeClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedEmployee = await employeeClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(signedEmployee.error, signedEmployee.error?.message).toBeNull();
    const employeeToken = signedEmployee.data.session?.access_token;
    expect(employeeToken).toBeTruthy();

    const bootstrapResponse = await request.post(`${appUrl}/api/mobile/employee/bootstrap`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    const bootstrap = await jsonText(bootstrapResponse);
    expect(bootstrapResponse.ok(), `Employee bootstrap failed: ${bootstrap.text}`).toBeTruthy();
    expect(bootstrap.body.employee?.id).toBe(employeeRecordId);
    expect(bootstrap.body.employee?.crewId).toBe(crewId);

    const employeeRouteResponse = await request.get(`${appUrl}/api/mobile/employee/route?date=${routeDate}`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    const employeeRoute = await jsonText(employeeRouteResponse);
    expect(employeeRouteResponse.ok(), `Employee Route failed: ${employeeRoute.text}`).toBeTruthy();
    expect(employeeRoute.body.routeId).toBe(routeId);
    expect(employeeRoute.body.stops?.length).toBe(1);
    expect(employeeRoute.body.stops?.[0]?.visitId).toBe(visitId);
    expect(employeeRoute.body.stops?.[0]?.status).toBe("scheduled");

    const startResponse = await request.patch(`${appUrl}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${employeeToken}` },
      data: { visitId, action: "start" },
    });
    const startResult = await jsonText(startResponse);
    expect(startResponse.ok(), `Employee Start failed: ${startResult.text}`).toBeTruthy();
    expect(startResult.body.visit?.status).toBe("in_progress");
    expect(startResult.body.visit?.started_at).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "visit-started", visitId }));

    // Simulate closing the mobile app: discard the authenticated client/session entirely,
    // create a fresh client, sign in again, and reload the canonical Employee Route.
    await employeeClient.auth.signOut();
    const reopenedClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const reopenedSignIn = await reopenedClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(reopenedSignIn.error, reopenedSignIn.error?.message).toBeNull();
    const reopenedToken = reopenedSignIn.data.session?.access_token;
    expect(reopenedToken).toBeTruthy();

    const reopenedRouteResponse = await request.get(`${appUrl}/api/mobile/employee/route?date=${routeDate}`, {
      headers: { authorization: `Bearer ${reopenedToken}` },
    });
    const reopenedRoute = await jsonText(reopenedRouteResponse);
    expect(reopenedRouteResponse.ok(), `Employee Route after relaunch failed: ${reopenedRoute.text}`).toBeTruthy();
    const reopenedStop = reopenedRoute.body.stops?.find((row: any) => row.visitId === visitId);
    expect(reopenedStop?.status).toBe("in_progress");
    expect(reopenedStop?.startedAt).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "mobile-relaunch-persisted", visitId, status: reopenedStop?.status }));

    const doneResponse = await request.patch(`${appUrl}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${reopenedToken}` },
      data: { visitId, action: "done" },
    });
    const doneResult = await jsonText(doneResponse);
    expect(doneResponse.ok(), `Employee Done failed: ${doneResult.text}`).toBeTruthy();
    expect(doneResult.body.visit?.status).toBe("completed");
    expect(doneResult.body.visit?.finished_at).toBeTruthy();
    expect(Number(doneResult.body.visit?.duration_seconds)).toBeGreaterThanOrEqual(0);

    const completedRead = await service.from("visits")
      .select("id,status,started_at,finished_at,duration_seconds,route_id,route_order")
      .eq("id", visitId)
      .single();
    expect(completedRead.error, completedRead.error?.message).toBeNull();
    expect(completedRead.data?.status).toBe("completed");
    expect(completedRead.data?.started_at).toBeTruthy();
    expect(completedRead.data?.finished_at).toBeTruthy();
    expect(completedRead.data?.route_id).toBe(routeId);
    expect(completedRead.data?.route_order).toBe(1);
    console.log(JSON.stringify({ checkpoint: "visit-done-history-ready", visitId, routeId }));
  } finally {
    if (routeId) {
      await service.from("route_stops").delete().eq("route_id", routeId);
      await service.from("visits").delete().eq("route_id", routeId);
      await service.from("routes").delete().eq("id", routeId);
    } else if (visitId) {
      await service.from("visits").delete().eq("id", visitId);
    }
    if (employeeRecordId) await service.from("employees").delete().eq("id", employeeRecordId);
    if (crewId) await service.from("crews").delete().eq("id", crewId);
    if (employeeUserId) {
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
