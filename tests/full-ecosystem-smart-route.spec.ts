import { test, expect, type APIResponse } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function bodyOf(response: APIResponse, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return body;
}

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

test("Employee Smart Route reorders three houses and survives relaunch", async ({ request }) => {
  test.setTimeout(120_000);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const authClient = () => createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const companyId = randomUUID();
  const adminEmail = `damasio.smart.admin.${suffix}@gmail.com`;
  const employeeEmail = `damasio.smart.employee.${suffix}@gmail.com`;
  const adminPassword = `QaAdmin!${suffix}Aa1`;
  const employeePassword = `QaEmployee!${suffix}Aa1`;
  const date = torontoDateKey();
  let adminId = "";
  let employeeProfileId = "";
  let employeeId = "";
  let crewId = "";
  let routeId = "";
  const customerIds: string[] = [];
  const propertyIds: string[] = [];
  const quoteIds: string[] = [];
  const jobIds: string[] = [];
  const visitIds: string[] = [];

  try {
    const company = await service.from("organizations").insert({
      id: companyId,
      name: `QA Smart Route ${suffix}`,
      slug: `qa-smart-route-${suffix}`.toLowerCase(),
      active: true,
      plan_name: "professional",
      contact_email: adminEmail,
    });
    expect(company.error, company.error?.message).toBeNull();

    const adminAuth = await service.auth.admin.createUser({
      email: adminEmail, password: adminPassword, email_confirm: true,
      user_metadata: { full_name: "QA Smart Admin", role: "admin", company_id: companyId },
    });
    expect(adminAuth.error, adminAuth.error?.message).toBeNull();
    adminId = adminAuth.data.user?.id || "";
    const adminProfile = await service.from("profiles").upsert({
      id: adminId, organization_id: companyId, company_id: companyId,
      role: "admin", full_name: "QA Smart Admin", email: adminEmail, active: true,
    });
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();

    const employeeAuth = await service.auth.admin.createUser({
      email: employeeEmail, password: employeePassword, email_confirm: true,
      user_metadata: { full_name: "QA Smart Worker", role: "employee", company_id: companyId },
    });
    expect(employeeAuth.error, employeeAuth.error?.message).toBeNull();
    employeeProfileId = employeeAuth.data.user?.id || "";
    const employeeProfile = await service.from("profiles").upsert({
      id: employeeProfileId, organization_id: companyId, company_id: companyId,
      role: "employee", full_name: "QA Smart Worker", email: employeeEmail, active: true,
      route_start_address: "71 Main St W, Hamilton, ON",
    });
    expect(employeeProfile.error, employeeProfile.error?.message).toBeNull();

    const crew = await service.from("crews").insert({
      organization_id: companyId, company_id: companyId, name: "QA Smart Worker", active: true,
    }).select("id").single();
    expect(crew.error, crew.error?.message).toBeNull();
    crewId = crew.data?.id || "";

    const employee = await service.from("employees").insert({
      organization_id: companyId, company_id: companyId, profile_id: employeeProfileId, crew_id: crewId,
      full_name: "QA Smart Worker", email: employeeEmail, active: true,
      route_start_address: "71 Main St W, Hamilton, ON", invite_status: "accepted",
    }).select("id").single();
    expect(employee.error, employee.error?.message).toBeNull();
    employeeId = employee.data?.id || "";

    const addresses = [
      ["100 Main St W", "L8P 1H6"],
      ["200 King St E", "L8N 1B5"],
      ["300 James St N", "L8L 1H2"],
    ];
    for (let index = 0; index < addresses.length; index += 1) {
      const customerId = randomUUID();
      const propertyId = randomUUID();
      const quoteId = randomUUID();
      const jobId = randomUUID();
      customerIds.push(customerId); propertyIds.push(propertyId); quoteIds.push(quoteId); jobIds.push(jobId);
      const customer = await service.from("customers").insert({
        id: customerId, organization_id: companyId, company_id: companyId, service_company_id: companyId,
        full_name: `QA Smart Customer ${index + 1}`, acquisition_source: "company_created",
        assignment_status: "active", offer_status: "accepted", platform_managed: false,
      });
      expect(customer.error, customer.error?.message).toBeNull();
      const property = await service.from("properties").insert({
        id: propertyId, organization_id: companyId, company_id: companyId, customer_id: customerId,
        address_line1: addresses[index][0], city: "Hamilton", province: "ON", postal_code: addresses[index][1], country: "Canada",
      });
      expect(property.error, property.error?.message).toBeNull();
      const quote = await service.from("quotes").insert({
        id: quoteId, organization_id: companyId, company_id: companyId, customer_id: customerId, property_id: propertyId,
        quote_number: `Q-SMART-${suffix}-${index + 1}`, status: "approved", subtotal: 40, tax: 5.2, total: 45.2,
      });
      expect(quote.error, quote.error?.message).toBeNull();
      const job = await service.from("jobs").insert({
        id: jobId, organization_id: companyId, company_id: companyId, customer_id: customerId, property_id: propertyId,
        quote_id: quoteId, service_name: "Lawn Cutting", frequency: "weekly", active: true,
      });
      expect(job.error, job.error?.message).toBeNull();
    }

    const adminClient = authClient();
    const adminSession = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    expect(adminSession.error, adminSession.error?.message).toBeNull();
    const adminToken = adminSession.data.session?.access_token;
    expect(adminToken).toBeTruthy();

    const board = await bodyOf(await request.get(`${appUrl}/api/admin/routes?date=${date}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }), "Admin route board");
    expect(board.employees?.some((row: any) => row.employeeId === employeeId && row.crewId === crewId)).toBeTruthy();
    expect(jobIds.every(id => board.board?.unscheduledJobs?.some((row: any) => row.id === id))).toBeTruthy();

    await bodyOf(await request.post(`${appUrl}/api/admin/routes`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { action: "smart", jobIds, employeeId, crewId, routeDate: date },
    }), "Admin multi-house route publish");

    const routeVisits = await service.from("visits")
      .select("id,job_id,route_id,route_order,status")
      .in("job_id", jobIds).eq("scheduled_date", date)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .order("route_order", { ascending: true });
    expect(routeVisits.error, routeVisits.error?.message).toBeNull();
    expect(routeVisits.data?.length).toBe(3);
    routeId = routeVisits.data?.[0]?.route_id || "";
    expect(routeId).not.toBe("");
    expect(routeVisits.data?.every((row: any) => row.route_id === routeId)).toBeTruthy();
    visitIds.push(...(routeVisits.data || []).map((row: any) => String(row.id)));
    expect((routeVisits.data || []).map((row: any) => row.route_order)).toEqual([1, 2, 3]);

    const employeeClient = authClient();
    const employeeSession = await employeeClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(employeeSession.error, employeeSession.error?.message).toBeNull();
    const employeeToken = employeeSession.data.session?.access_token;
    expect(employeeToken).toBeTruthy();

    const before = await bodyOf(await request.get(`${appUrl}/api/mobile/employee/route?date=${date}`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    }), "Employee route before Smart Route");
    expect(before.routeId).toBe(routeId);
    const beforeOrder = (before.stops || []).map((stop: any) => String(stop.visitId));
    expect(beforeOrder).toEqual(visitIds);

    // A newly published legacy-compatible route may not have route_order_state yet. The
    // canonical writer is explicitly responsible for initializing version 1 on first apply.
    const stateBefore = await service.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle();
    expect(stateBefore.error, stateBefore.error?.message).toBeNull();
    const previousVersion = stateBefore.data ? Number(stateBefore.data.version) : null;
    const reversed = [...beforeOrder].reverse();

    const applied = await bodyOf(await request.post(`${appUrl}/api/mobile/employee/smart-route`, {
      headers: { authorization: `Bearer ${employeeToken}` },
      data: {
        action: "apply",
        routeId,
        originalOrder: beforeOrder,
        appliedOrder: reversed,
        expectedVersion: previousVersion,
        origin: { label: "71 Main St W, Hamilton, ON", latitude: 43.2557, longitude: -79.8711 },
      },
    }), "Employee Smart Route apply");
    expect(applied.saved).toBe(true);
    expect(applied.routeId).toBe(routeId);
    expect(applied.appliedOrder || applied.orderedVisitIds).toEqual(reversed);
    const nextVersion = Number(applied.routeVersion || applied.version);
    expect(nextVersion).toBeGreaterThan(previousVersion || 0);

    const stateAfter = await service.from("route_order_state")
      .select("version,last_source,last_actor_profile_id")
      .eq("route_id", routeId).single();
    expect(stateAfter.error, stateAfter.error?.message).toBeNull();
    expect(Number(stateAfter.data?.version)).toBe(nextVersion);
    expect(stateAfter.data?.last_source).toBe("employee_smart_route");
    expect(stateAfter.data?.last_actor_profile_id).toBe(employeeProfileId);

    const stopsAfter = await service.from("route_stops")
      .select("visit_id,position").eq("route_id", routeId).order("position", { ascending: true });
    expect(stopsAfter.error, stopsAfter.error?.message).toBeNull();
    expect((stopsAfter.data || []).map((row: any) => String(row.visit_id))).toEqual(reversed);
    expect((stopsAfter.data || []).map((row: any) => Number(row.position))).toEqual([1, 2, 3]);

    const projectionAfter = await service.from("visits")
      .select("id,route_order").in("id", reversed).order("route_order", { ascending: true });
    expect(projectionAfter.error, projectionAfter.error?.message).toBeNull();
    expect((projectionAfter.data || []).map((row: any) => String(row.id))).toEqual(reversed);
    expect((projectionAfter.data || []).map((row: any) => Number(row.route_order))).toEqual([1, 2, 3]);

    await employeeClient.auth.signOut();
    const freshClient = authClient();
    const freshSession = await freshClient.auth.signInWithPassword({ email: employeeEmail, password: employeePassword });
    expect(freshSession.error, freshSession.error?.message).toBeNull();
    const freshToken = freshSession.data.session?.access_token;
    const afterRelaunch = await bodyOf(await request.get(`${appUrl}/api/mobile/employee/route?date=${date}`, {
      headers: { authorization: `Bearer ${freshToken}` },
    }), "Employee route after Smart Route relaunch");
    expect((afterRelaunch.stops || []).map((stop: any) => String(stop.visitId))).toEqual(reversed);

    const audit = await service.from("route_order_audit")
      .select("route_id,source,next_order,route_version").eq("route_id", routeId)
      .eq("source", "employee_smart_route").order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(audit.error, audit.error?.message).toBeNull();
    expect(audit.data?.route_id).toBe(routeId);
    expect((audit.data?.next_order || []).map(String)).toEqual(reversed);
    expect(Number(audit.data?.route_version)).toBe(nextVersion);
    console.log(JSON.stringify({ checkpoint: "smart-route-multi-house-persisted", routeId, previousVersion, nextVersion, reversed }));
  } finally {
    if (routeId) {
      await service.from("route_order_audit").delete().eq("route_id", routeId);
      await service.from("route_order_state").delete().eq("route_id", routeId);
      await service.from("route_stops").delete().eq("route_id", routeId);
      await service.from("visits").delete().eq("route_id", routeId);
      await service.from("routes").delete().eq("id", routeId);
    } else if (visitIds.length) await service.from("visits").delete().in("id", visitIds);
    if (jobIds.length) await service.from("jobs").delete().in("id", jobIds);
    if (quoteIds.length) await service.from("quotes").delete().in("id", quoteIds);
    if (propertyIds.length) await service.from("properties").delete().in("id", propertyIds);
    if (customerIds.length) await service.from("customers").delete().in("id", customerIds);
    if (employeeId) await service.from("employees").delete().eq("id", employeeId);
    if (crewId) await service.from("crews").delete().eq("id", crewId);
    if (employeeProfileId) {
      await service.from("profiles").delete().eq("id", employeeProfileId);
      await service.auth.admin.deleteUser(employeeProfileId).catch(() => undefined);
    }
    if (adminId) {
      await service.from("profiles").delete().eq("id", adminId);
      await service.auth.admin.deleteUser(adminId).catch(() => undefined);
    }
    await service.from("organizations").delete().eq("id", companyId);
  }
});
