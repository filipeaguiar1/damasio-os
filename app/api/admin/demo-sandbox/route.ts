import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SANDBOX_MARKER = "[TEMP_DEMO_SANDBOX_V1]";
const WORKER_NAME = "Demo Field Worker";

const properties = [
  ["71 Main St W", "Hamilton", "L8P 4Y5"],
  ["55 York Blvd", "Hamilton", "L8R 3K1"],
  ["100 Main St W", "Hamilton", "L8P 1H6"],
  ["101 York Blvd", "Hamilton", "L8R 3L4"],
  ["135 Fennell Ave W", "Hamilton", "L9C 0E5"],
  ["1280 Main St W", "Hamilton", "L8S 4L8"],
  ["175 Longwood Rd S", "Hamilton", "L8P 0A1"],
  ["900 Woodward Ave", "Hamilton", "L8H 7N2"],
  ["777 Guelph Line", "Burlington", "L7R 3N2"],
  ["426 Brant St", "Burlington", "L7R 3Z6"],
  ["2331 New St", "Burlington", "L7R 1J4"],
  ["1240 North Shore Blvd E", "Burlington", "L7S 1C5"],
  ["680 Plains Rd W", "Burlington", "L7T 4H4"],
  ["414 Locust St", "Burlington", "L7S 1T7"],
  ["1200 Brant St", "Burlington", "L7P 5C6"],
  ["1225 Trafalgar Rd", "Oakville", "L6H 0H3"],
  ["120 Navy St", "Oakville", "L6J 2Z4"],
  ["1306 Lakeshore Rd E", "Oakville", "L6J 1L6"],
  ["1415 Third Line", "Oakville", "L6M 3G2"],
  ["2302 Bridge Rd", "Oakville", "L6L 2G6"],
  ["2400 Sixth Line", "Oakville", "L6H 3N8"],
  ["1075 North Service Rd W", "Oakville", "L6M 2G2"],
  ["1333 Dorval Dr", "Oakville", "L6M 4G2"],
  ["1455 Glen Abbey Gate", "Oakville", "L6M 2V7"],
  ["1565 Cornwall Rd", "Oakville", "L6J 0B2"],
] as const;

const services = [
  { name: "Weekly Lawn Care", frequency: "weekly", subtotal: 45 },
  { name: "Biweekly Lawn Care", frequency: "biweekly", subtotal: 55 },
  { name: "Spring Cleanup", frequency: "one_time", subtotal: 229 },
  { name: "Fall Cleanup", frequency: "one_time", subtotal: 249 },
  { name: "Snow Removal", frequency: "weekly", subtotal: 65 },
] as const;

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Demo sandbox is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser access is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

async function companyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serverClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");

  const { data: profile, error } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile?.active || profile.role !== "admin") {
    throw new Error("Only the company Admin can create or remove temporary demo data.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");

  return { service, user: userClient(token), companyId };
}

function sandboxPattern(companyId: string) {
  return `sandbox-${companyId.slice(0, 8)}-%@4everseasons.test`;
}

function securePassword() {
  return `Fs!${randomBytes(12).toString("base64url")}9a`;
}

function isMissingColumn(message?: string) {
  return /(column|schema cache|does not exist)/i.test(message || "");
}

async function insertCustomer(service: any, payload: Record<string, unknown>) {
  let result = await service.from("customers").insert(payload).select("id").single();
  if (result.error && isMissingColumn(result.error.message)) {
    const { service_company_id: _serviceCompany, acquisition_source: _source,
      assignment_status: _assignment, offer_status: _offer,
      platform_managed: _platform, ...fallback } = payload;
    result = await service.from("customers").insert(fallback).select("id").single();
  }
  if (result.error || !result.data?.id) throw new Error(result.error?.message || "Demo customer could not be created.");
  return String(result.data.id);
}

async function createWorker(service: any, companyId: string, runId: string) {
  const email = `sandbox-${companyId.slice(0, 8)}-${runId}-worker@4everseasons.test`;
  const password = securePassword();
  let userId = "";
  let crewId = "";

  try {
    const authResult = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: WORKER_NAME,
        role: "employee",
        company_id: companyId,
        demo_sandbox: true,
      },
    });
    if (authResult.error || !authResult.data.user) {
      throw new Error(authResult.error?.message || "Demo worker login could not be created.");
    }
    userId = authResult.data.user.id;

    const crew = await service.from("crews").insert({
      organization_id: companyId,
      company_id: companyId,
      name: `${WORKER_NAME} · Temporary Sandbox`,
      active: true,
    }).select("id").single();
    if (crew.error || !crew.data?.id) throw new Error(crew.error?.message || "Demo crew could not be created.");
    crewId = String(crew.data.id);

    const profile = {
      id: userId,
      organization_id: companyId,
      company_id: companyId,
      role: "employee",
      full_name: WORKER_NAME,
      email,
      address_line1: "71 Main St W, Hamilton, ON",
      route_start_address: "71 Main St W, Hamilton, ON",
      active: true,
      invite_status: "accepted",
      daily_route_capacity: 16,
    };

    let profileResult = await service.from("profiles").upsert(profile, { onConflict: "id" });
    if (profileResult.error && isMissingColumn(profileResult.error.message)) {
      const { daily_route_capacity: _capacity, ...fallback } = profile;
      profileResult = await service.from("profiles").upsert(fallback, { onConflict: "id" });
    }
    if (profileResult.error) throw new Error(profileResult.error.message);

    const employee = {
      organization_id: companyId,
      company_id: companyId,
      profile_id: userId,
      crew_id: crewId,
      full_name: WORKER_NAME,
      email,
      address_line1: "71 Main St W, Hamilton, ON",
      route_start_address: "71 Main St W, Hamilton, ON",
      active: true,
      invite_status: "accepted",
      daily_route_capacity: 16,
    };

    let employeeResult = await service.from("employees").insert(employee);
    if (employeeResult.error && isMissingColumn(employeeResult.error.message)) {
      const { daily_route_capacity: _capacity, ...fallback } = employee;
      employeeResult = await service.from("employees").insert(fallback);
    }
    if (employeeResult.error) throw new Error(employeeResult.error.message);

    return { email, password, userId, crewId };
  } catch (error) {
    if (userId) await service.auth.admin.deleteUser(userId).catch(() => undefined);
    if (crewId) await service.from("crews").delete().eq("id", crewId);
    throw error;
  }
}

async function createCustomers(service: any, companyId: string, runId: string) {
  const createdCustomerIds: string[] = [];

  for (let index = 0; index < properties.length; index += 1) {
    const number = String(index + 1).padStart(2, "0");
    const [addressLine1, city, postalCode] = properties[index];
    const service = services[index % services.length];
    const email = `sandbox-${companyId.slice(0, 8)}-${runId}-customer-${number}@4everseasons.test`;
    const tax = Math.round(service.subtotal * 0.13 * 100) / 100;
    const total = Math.round((service.subtotal + tax) * 100) / 100;

    const customerId = await insertCustomer(serviceClient(), {
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      full_name: `Demo Customer ${number}`,
      email,
      phone: `905-555-${String(1000 + index).slice(-4)}`,
      notes: `${SANDBOX_MARKER} Temporary customer for route, dispatch and mobile simulation.`,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
      archived_at: null,
    });
    createdCustomerIds.push(customerId);

    const propertyResult = await service.from("properties").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      address_line1: addressLine1,
      city,
      province: "ON",
      postal_code: postalCode,
      country: "Canada",
      lot_size: ["xs", "small", "legacy", "oversize"][index % 4],
      grass_height: ["2in", "3in", "4in", "5in"][index % 4],
      gate: index % 3 === 0,
      dog: index % 5 === 0,
      irrigation: index % 4 === 0,
      access_notes: `${SANDBOX_MARKER} Public-location demo property; no real resident is represented.`,
      property_notes: `Service type: ${service.name}\n${SANDBOX_MARKER}`,
      geocode_status: "not_mapped",
    }).select("id").single();
    if (propertyResult.error || !propertyResult.data?.id) throw new Error(propertyResult.error?.message || "Demo property could not be created.");
    const propertyId = String(propertyResult.data.id);

    const quoteResult = await service.from("quotes").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: `DEMO-${runId.toUpperCase()}-${number}`,
      status: "approved",
      subtotal: service.subtotal,
      tax,
      total,
      notes: `${service.name} · ${SANDBOX_MARKER}`,
    }).select("id").single();
    if (quoteResult.error || !quoteResult.data?.id) throw new Error(quoteResult.error?.message || "Demo quote could not be created.");

    const jobResult = await service.from("jobs").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_id: quoteResult.data.id,
      service_name: service.name,
      frequency: service.frequency,
      active: true,
      next_visit_date: null,
    });
    if (jobResult.error) throw new Error(jobResult.error.message);
  }

  return createdCustomerIds;
}

async function removeSandbox(service: any, user: any, companyId: string) {
  const pattern = sandboxPattern(companyId);
  const customers = await service.from("customers")
    .select("id")
    .or(companyFilter(companyId))
    .like("email", pattern)
    .is("archived_at", null);
  if (customers.error) throw new Error(customers.error.message);
  const customerIds = (customers.data || []).map((row: any) => String(row.id));

  let archived = 0;
  if (customerIds.length) {
    const result = await user.rpc("archive_company_customers", { p_customer_ids: customerIds });
    if (result.error) throw new Error(result.error.message);
    archived = Number(result.data || 0);
  }

  const profiles = await service.from("profiles")
    .select("id")
    .eq("role", "employee")
    .or(companyFilter(companyId))
    .like("email", pattern);
  if (profiles.error) throw new Error(profiles.error.message);

  let workersRemoved = 0;
  for (const profile of profiles.data || []) {
    const employees = await service.from("employees")
      .select("id,crew_id")
      .eq("profile_id", profile.id)
      .or(companyFilter(companyId));
    if (employees.error) throw new Error(employees.error.message);

    for (const employee of employees.data || []) {
      await service.from("employees").update({ active: false, profile_id: null }).eq("id", employee.id);
      if (employee.crew_id) await service.from("crews").update({ active: false }).eq("id", employee.crew_id);
    }

    const authResult = await service.auth.admin.deleteUser(profile.id);
    if (authResult.error && !/not found/i.test(authResult.error.message)) throw new Error(authResult.error.message);
    workersRemoved += 1;
  }

  return { archived, workersRemoved };
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    const pattern = sandboxPattern(companyId);
    const [customers, workers] = await Promise.all([
      service.from("customers").select("id", { count: "exact", head: true })
        .or(companyFilter(companyId)).like("email", pattern).is("archived_at", null),
      service.from("profiles").select("id,full_name,email")
        .eq("role", "employee").or(companyFilter(companyId)).like("email", pattern),
    ]);
    if (customers.error) throw new Error(customers.error.message);
    if (workers.error) throw new Error(workers.error.message);
    return NextResponse.json({ customerCount: customers.count || 0, workers: workers.data || [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sandbox status failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, companyId } = await companyAdmin(request);
    const body = await request.json() as { action?: "create" | "remove" };

    if (body.action === "remove") {
      const removed = await removeSandbox(service, user, companyId);
      return NextResponse.json({
        removed: true,
        ...removed,
        message: `${removed.archived} demo customers archived and ${removed.workersRemoved} demo worker account removed.`,
      });
    }

    const existing = await service.from("customers")
      .select("id", { count: "exact", head: true })
      .or(companyFilter(companyId))
      .like("email", sandboxPattern(companyId))
      .is("archived_at", null);
    if (existing.error) throw new Error(existing.error.message);
    if ((existing.count || 0) > 0) {
      throw new Error("A temporary demo sandbox already exists. Remove it before creating another one.");
    }

    const runId = Date.now().toString(36);
    const worker = await createWorker(service, companyId, runId);
    try {
      const customerIds = await createCustomers(service, companyId, runId);
      return NextResponse.json({
        created: true,
        customerCount: customerIds.length,
        worker: { name: WORKER_NAME, email: worker.email, password: worker.password },
        message: `${customerIds.length} canonical demo customers and one demo worker were created for this company.`,
      }, { status: 201 });
    } catch (error) {
      await removeSandbox(service, user, companyId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("admin-demo-sandbox", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Demo sandbox operation failed." }, { status: 400 });
  }
}
