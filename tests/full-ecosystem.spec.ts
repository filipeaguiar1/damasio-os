import { test, expect, type APIResponse } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function required(name: string, value?: string) {
  if (!value) throw new Error(`Missing required E2E secret: ${name}`);
}

async function bodyOf(response: APIResponse, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
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

test("full SaaS ecosystem from Master company creation through Customer History", async ({ request }) => {
  test.setTimeout(150_000);
  required("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  required("SUPABASE_SERVICE_ROLE_KEY", serviceKey);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safe = stamp.replace(/[^a-z0-9]/gi, "");
  const routeDate = torontoDateKey();
  const masterEmail = `qa-master-${stamp}@example.com`;
  const adminEmail = `damasio.qa.admin.${safe}@gmail.com`;
  const employeeEmail = `damasio.qa.employee.${safe}@gmail.com`;
  const customerEmail = `damasio.qa.customer.${safe}@gmail.com`;
  const masterPassword = `QaMaster!${safe}Aa1`;
  const adminSeedPassword = `QaAdmin!${safe}Aa1`;
  const employeePassword = `QaEmployee!${safe}Aa1`;
  const customerPassword = `QaCustomer!${safe}Aa1`;

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const authClient = () => createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

  let masterUserId = "";
  let adminUserId = "";
  let employeeUserId = "";
  let customerUserId = "";
  let employeeRecordId = "";
  let crewId = "";
  let companyId = "";
  let customerId = "";
  let propertyId = "";
  let quoteId = "";
  let jobId = "";
  let visitId = "";
  let routeId = "";
  let feedbackId = "";
  let taskId = "";
  let serviceRequestId = "";

  try {
    // MASTER -> COMPANY -> FIRST ADMIN
    const masterAuth = await service.auth.admin.createUser({
      email: masterEmail,
      password: masterPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Master" },
    });
    expect(masterAuth.error, masterAuth.error?.message).toBeNull();
    masterUserId = masterAuth.data.user?.id || "";
    expect(masterUserId).not.toBe("");
    const masterProfile = await service.from("profiles").upsert({
      id: masterUserId,
      role: "master",
      full_name: "QA Master",
      email: masterEmail,
      active: true,
    });
    expect(masterProfile.error, masterProfile.error?.message).toBeNull();

    // Existing Auth identity avoids external email delivery while still exercising the real
    // Master company endpoint and its Admin-linking path.
    const adminSeed = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminSeedPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Company Admin" },
    });
    expect(adminSeed.error, adminSeed.error?.message).toBeNull();
    adminUserId = adminSeed.data.user?.id || "";

    const masterSession = await authClient().auth.signInWithPassword({ email: masterEmail, password: masterPassword });
    expect(masterSession.error, masterSession.error?.message).toBeNull();
    const masterToken = masterSession.data.session?.access_token;
    expect(masterToken).toBeTruthy();

    const company = await bodyOf(await request.post(`${appUrl}/api/master/companies`, {
      headers: { authorization: `Bearer ${masterToken}` },
      data: {
        name: `QA Ecosystem ${stamp}`,
        slug: `qa-ecosystem-${stamp}`,
        plan: "professional",
        adminName: "QA Company Admin",
        adminEmail,
      },
    }), "Master company creation");
    companyId = company.company?.id || company.id || "";
    expect(companyId).not.toBe("");

    const adminProfile = await service.from("profiles")
      .select("id,role,active,company_id,organization_id")
      .eq("id", adminUserId).single();
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();
    expect(adminProfile.data?.role).toBe("admin");
    expect(adminProfile.data?.active).toBe(true);
    expect(adminProfile.data?.company_id || adminProfile.data?.organization_id).toBe(companyId);

    const adminPassword = company.temporaryPassword || adminSeedPassword;
    const adminClient = authClient();
    const adminSession = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    expect(adminSession.error, adminSession.error?.message).toBeNull();
    const adminToken = adminSession.data.session?.access_token;
    expect(adminToken).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "master-company-admin", companyId, adminUserId }));

    // ADMIN -> CUSTOMER -> PROPERTY -> APPROVED QUOTE -> ACTIVE JOB
    const chain = await bodyOf(await request.post(`${appUrl}/api/admin/customers`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: {
        fullName: "QA Ecosystem Customer",
        email: customerEmail,
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
    }), "Canonical Customer chain");
    customerId = chain.customerId || "";
    propertyId = chain.propertyId || "";
    quoteId = chain.quoteId || "";
    jobId = chain.jobId || "";
    for (const value of [customerId, propertyId, quoteId, jobId]) expect(value).not.toBe("");

    const directory = await bodyOf(await request.get(`${appUrl}/api/admin/customers`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }), "Admin Customer directory");
    expect(directory.records?.some((row: any) => row.customerId === customerId && row.propertyId === propertyId)).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "customer-property-quote-job", customerId, propertyId, quoteId, jobId }));

    // Seed Employee Auth identity without relying on email provider. Canonical profile/Crew/
    // Employee records are the exact rows consumed by Admin Route and Employee Mobile APIs.
    const employeeAuth = await service.auth.admin.createUser({
      email: employeeEmail,
      password: employeePassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Route Worker", role: "employee", company_id: companyId },
    });
    expect(employeeAuth.error, employeeAuth.error?.message).toBeNull();
    employeeUserId = employeeAuth.data.user?.id || "";

    const employeeProfile = await service.from("profiles").upsert({
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
    expect(employeeProfile.error, employeeProfile.error?.message).toBeNull();

    const crew = await service.from("crews").insert({
      organization_id: companyId,
      company_id: companyId,
      name: "QA Route Worker",
      active: true,
    }).select("id").single();
    expect(crew.error, crew.error?.message).toBeNull();
    crewId = crew.data?.id || "";

    const employee = await service.from("employees").insert({
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
    expect(employee.error, employee.error?.message).toBeNull();
    employeeRecordId = employee.data?.id || "";

    // ADMIN SCHEDULE / DISPATCH / ROUTE
    const routeBoard = await bodyOf(await request.get(`${appUrl}/api/admin/routes?date=${routeDate}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }), "Admin Route board");
    expect(routeBoard.employees?.some((row: any) => row.employeeId === employeeRecordId && row.crewId === crewId)).toBeTruthy();
    expect(routeBoard.board?.unscheduledJobs?.some((row: any) => row.id === jobId)).toBeTruthy();

    await bodyOf(await request.post(`${appUrl}/api/admin/routes`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { action: "smart", jobIds: [jobId], employeeId: employeeRecordId, crewId, routeDate },
    }), "Admin canonical Route publish");

    const visit = await service.from("visits")
      .select("id,route_id,route_order,status,assigned_employee_id,crew_id,customer_id,property_id")
      .eq("job_id", jobId)
      .eq("scheduled_date", routeDate)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    expect(visit.error, visit.error?.message).toBeNull();
    visitId = visit.data?.id || "";
    routeId = visit.data?.route_id || "";
    expect(visitId).not.toBe("");
    expect(routeId).not.toBe("");
    expect(visit.data?.route_order).toBe(1);
    expect(visit.data?.status).toBe("scheduled");
    expect(visit.data?.assigned_employee_id).toBe(employeeRecordId);
    console.log(JSON.stringify({ checkpoint: "schedule-dispatch-route", routeId, visitId }));

    // EMPLOYEE -> BOOTSTRAP -> START -> CLOSE/REOPEN MOBILE -> DONE
    const employeeClient = authClient();
    const employeeSession = await employeeClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(employeeSession.error, employeeSession.error?.message).toBeNull();
    const employeeToken = employeeSession.data.session?.access_token;
    expect(employeeToken).toBeTruthy();

    const bootstrap = await bodyOf(await request.post(`${appUrl}/api/mobile/employee/bootstrap`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    }), "Employee bootstrap");
    expect(bootstrap.employee?.id).toBe(employeeRecordId);
    expect(bootstrap.employee?.crewId).toBe(crewId);

    const mobileRoute = await bodyOf(await request.get(`${appUrl}/api/mobile/employee/route?date=${routeDate}`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    }), "Employee Route");
    expect(mobileRoute.routeId).toBe(routeId);
    expect(mobileRoute.stops?.some((row: any) => row.visitId === visitId && row.status === "scheduled")).toBeTruthy();

    const started = await bodyOf(await request.patch(`${appUrl}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${employeeToken}` },
      data: { visitId, action: "start" },
    }), "Employee Start");
    expect(started.visit?.status).toBe("in_progress");
    expect(started.visit?.started_at).toBeTruthy();

    await employeeClient.auth.signOut();
    const reopenedEmployeeClient = authClient();
    const reopenedSession = await reopenedEmployeeClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(reopenedSession.error, reopenedSession.error?.message).toBeNull();
    const reopenedToken = reopenedSession.data.session?.access_token;
    expect(reopenedToken).toBeTruthy();

    const reopenedRoute = await bodyOf(await request.get(`${appUrl}/api/mobile/employee/route?date=${routeDate}`, {
      headers: { authorization: `Bearer ${reopenedToken}` },
    }), "Employee Route after app relaunch");
    const persistedStop = reopenedRoute.stops?.find((row: any) => row.visitId === visitId);
    expect(persistedStop?.status).toBe("in_progress");
    expect(persistedStop?.startedAt).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "mobile-relaunch-persisted", visitId }));

    const completed = await bodyOf(await request.patch(`${appUrl}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${reopenedToken}` },
      data: { visitId, action: "done" },
    }), "Employee Done");
    expect(completed.visit?.status).toBe("completed");
    expect(completed.visit?.finished_at).toBeTruthy();
    expect(Number(completed.visit?.duration_seconds)).toBeGreaterThanOrEqual(0);

    // CUSTOMER ACCOUNT -> FEEDBACK -> TASK -> SERVICE REQUEST
    const customerAuth = await service.auth.admin.createUser({
      email: customerEmail,
      password: customerPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Ecosystem Customer", role: "customer", company_id: companyId, customer_id: customerId },
    });
    expect(customerAuth.error, customerAuth.error?.message).toBeNull();
    customerUserId = customerAuth.data.user?.id || "";
    expect(customerUserId).not.toBe("");

    const customerProfile = await service.from("profiles").upsert({
      id: customerUserId,
      organization_id: companyId,
      company_id: companyId,
      role: "customer",
      full_name: "QA Ecosystem Customer",
      email: customerEmail,
      active: true,
    });
    expect(customerProfile.error, customerProfile.error?.message).toBeNull();
    const customerLink = await service.from("customers").update({ profile_id: customerUserId }).eq("id", customerId);
    expect(customerLink.error, customerLink.error?.message).toBeNull();

    const customerClient = authClient();
    const customerSession = await customerClient.auth.signInWithPassword({ email: customerEmail, password: customerPassword });
    expect(customerSession.error, customerSession.error?.message).toBeNull();
    const customerToken = customerSession.data.session?.access_token;
    expect(customerToken).toBeTruthy();

    await bodyOf(await request.post(`${appUrl}/api/customer/portal-actions`, {
      headers: { authorization: `Bearer ${customerToken}` },
      data: {
        action: "feedback",
        visitId,
        rating: 2,
        comment: "QA follow-up: edge near the side gate needs another pass.",
      },
    }), "Customer Feedback");

    const feedback = await service.from("feedback")
      .select("id,rating,comment,visit_id,customer_id,property_id")
      .eq("visit_id", visitId).eq("customer_id", customerId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(feedback.error, feedback.error?.message).toBeNull();
    feedbackId = feedback.data?.id || "";
    expect(feedbackId).not.toBe("");
    expect(feedback.data?.rating).toBe(2);

    const task = await service.from("tasks")
      .select("id,status,priority,source_visit_id,customer_id,property_id,title,customer_issue")
      .eq("source_visit_id", visitId).eq("customer_id", customerId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(task.error, task.error?.message).toBeNull();
    taskId = task.data?.id || "";
    expect(taskId).not.toBe("");
    expect(task.data?.status).toBe("open");
    expect(task.data?.priority).toBe("urgent");

    await bodyOf(await request.post(`${appUrl}/api/customer/portal-actions`, {
      headers: { authorization: `Bearer ${customerToken}` },
      data: {
        action: "request",
        propertyId,
        serviceName: "Sprinkler inspection",
        message: "Please inspect the front sprinkler zone on the next visit.",
      },
    }), "Customer Service Request");

    const serviceRequest = await service.from("service_requests")
      .select("id,status,customer_id,property_id,service_name")
      .eq("customer_id", customerId).eq("property_id", propertyId)
      .eq("service_name", "Sprinkler inspection")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(serviceRequest.error, serviceRequest.error?.message).toBeNull();
    serviceRequestId = serviceRequest.data?.id || "";
    expect(serviceRequestId).not.toBe("");
    expect(serviceRequest.data?.status).toBe("pending");

    // ADMIN must immediately see both Customer-created records.
    const requestsBoard = await bodyOf(await request.get(`${appUrl}/api/admin/service-requests`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }), "Admin Customer Requests");
    expect(requestsBoard.requests?.some((row: any) => row.id === taskId && row.kind === "customer_task")).toBeTruthy();
    expect(requestsBoard.requests?.some((row: any) => row.id === serviceRequestId && row.kind === "service_request")).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "feedback-task-request-visible-to-admin", feedbackId, taskId, serviceRequestId }));

    // Resolve the canonical Task using the same fields used by Admin Task workflow.
    const resolvedAt = new Date().toISOString();
    const resolvedTask = await service.from("tasks").update({
      status: "resolved",
      resolved_at: resolvedAt,
      completion_summary: "Side-gate edge corrected and Customer follow-up completed.",
    }).eq("id", taskId).select("id,status,resolved_at,completion_summary").single();
    expect(resolvedTask.error, resolvedTask.error?.message).toBeNull();
    expect(resolvedTask.data?.status).toBe("resolved");

    // CUSTOMER HISTORY source must now converge on the completed Visit and resolved Task.
    const historyRpc = await customerClient.rpc("get_customer_portal_board");
    expect(historyRpc.error, historyRpc.error?.message).toBeNull();
    const history = historyRpc.data as any;
    expect(history?.visits?.some((row: any) => row.id === visitId && row.status === "completed")).toBeTruthy();
    expect(history?.tasks?.some((row: any) => row.id === taskId && row.status === "resolved")).toBeTruthy();
    expect(history?.feedback?.some((row: any) => row.id === feedbackId && row.visitId === visitId)).toBeTruthy();
    expect(history?.requests?.some((row: any) => row.id === serviceRequestId)).toBeTruthy();
    expect(history?.quotes?.some((row: any) => row.id === quoteId)).toBeTruthy();
    console.log(JSON.stringify({ checkpoint: "customer-history-converged", visitId, taskId, quoteId }));
  } finally {
    if (feedbackId) await service.from("feedback").delete().eq("id", feedbackId);
    if (taskId) await service.from("tasks").delete().eq("id", taskId);
    if (serviceRequestId) await service.from("service_requests").delete().eq("id", serviceRequestId);
    if (customerUserId) {
      await service.from("customers").update({ profile_id: null }).eq("id", customerId);
      await service.from("profiles").delete().eq("id", customerUserId);
      await service.auth.admin.deleteUser(customerUserId).catch(() => undefined);
    }
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
