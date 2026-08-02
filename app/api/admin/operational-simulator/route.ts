import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  calculateOperationalSimulation,
  normalizeOperationalSimulationInput,
  visitCollectsClippings,
  visitServiceMinutes,
  type OperationalSimulationInput,
} from "@/lib/simulator/operationalSimulator";

export const dynamic = "force-dynamic";

const SIM_MARKER = "[OPERATIONAL_SIMULATION_V1]";
const WORKER_NAMES = ["Pedro Simulation", "Lucas Simulation"] as const;
const CITY_ROTATION = ["Hamilton", "Burlington", "Oakville"] as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational simulator is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function missingColumn(message?: string) {
  return /(column|schema cache|does not exist)/i.test(message || "");
}

function simulationPattern(companyId: string) {
  return `ops-sim-${companyId.slice(0, 8)}-%@4everseasons.test`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
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

function mondayOnOrBefore(value: string) {
  const date = dateFromKey(value);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return dateKey(date);
}

function isoAtMinutes(date: string, minutesAfterEight: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCMinutes(value.getUTCMinutes() + minutesAfterEight);
  return value.toISOString();
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function chunks<T>(rows: T[], size = 100) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function insertRows(client: any, table: string, rows: Record<string, unknown>[]) {
  for (const batch of chunks(rows)) {
    const result = await client.from(table).insert(batch);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
  }
}

async function insertRowsWithFallback(
  client: any,
  table: string,
  rows: Record<string, unknown>[],
  optionalKeys: string[],
) {
  for (const batch of chunks(rows)) {
    let result = await client.from(table).insert(batch);
    if (result.error && missingColumn(result.error.message)) {
      const fallback = batch.map(row => Object.fromEntries(
        Object.entries(row).filter(([key]) => !optionalKeys.includes(key)),
      ));
      result = await client.from(table).insert(fallback);
    }
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
  }
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,full_name,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || !["admin", "manager"].includes(profile.data.role)) {
    throw new Error("Only an active company Admin can run the operational simulation.");
  }

  const companyId = profile.data.company_id || profile.data.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return {
    service,
    companyId: String(companyId),
    actorId: String(auth.data.user.id),
    actorName: String(profile.data.full_name || "Márcio"),
  };
}

type WorkerRecord = {
  profileId: string;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  password: string;
};

async function createWorker(service: any, companyId: string, runId: string, index: number): Promise<WorkerRecord> {
  const name = WORKER_NAMES[index] || `Worker ${index + 1}`;
  const email = `ops-sim-${companyId.slice(0, 8)}-${runId}-worker-${index + 1}@4everseasons.test`;
  const password = `Fs!${randomBytes(12).toString("base64url")}7z`;
  const crewId = randomUUID();
  let profileId = "";

  try {
    const auth = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role: "employee", company_id: companyId, operational_simulation: true },
    });
    if (auth.error || !auth.data.user) throw new Error(auth.error?.message || "Simulation worker login could not be created.");
    profileId = String(auth.data.user.id);

    await insertRows(service, "crews", [{
      id: crewId,
      organization_id: companyId,
      company_id: companyId,
      name: `${name} · 30 homes weekly`,
      active: true,
    }]);

    const common = {
      organization_id: companyId,
      company_id: companyId,
      full_name: name,
      email,
      address_line1: "71 Main St W, Hamilton, ON",
      route_start_address: "71 Main St W, Hamilton, ON",
      active: true,
      invite_status: "accepted",
      daily_route_capacity: 8,
    };

    let profile = await service.from("profiles").upsert({ id: profileId, role: "employee", ...common }, { onConflict: "id" });
    if (profile.error && missingColumn(profile.error.message)) {
      const { route_start_address: _route, daily_route_capacity: _capacity, invite_status: _invite, ...fallback } = common;
      profile = await service.from("profiles").upsert({ id: profileId, role: "employee", ...fallback }, { onConflict: "id" });
    }
    if (profile.error) throw new Error(profile.error.message);

    const employeeId = randomUUID();
    await insertRowsWithFallback(service, "employees", [{
      id: employeeId,
      profile_id: profileId,
      crew_id: crewId,
      ...common,
    }], ["route_start_address", "daily_route_capacity", "invite_status"]);

    return { profileId, employeeId, crewId, name, email, password };
  } catch (error) {
    if (profileId) await service.auth.admin.deleteUser(profileId).catch(() => undefined);
    await service.from("crews").delete().eq("id", crewId);
    throw error;
  }
}

type CustomerChain = {
  customerId: string;
  propertyId: string;
  quoteId: string;
  jobId: string;
  customerName: string;
  email: string;
  workerIndex: number;
  serviceMinutes: number;
  collectClippings: boolean;
};

function createCustomerRows(
  companyId: string,
  runId: string,
  input: OperationalSimulationInput,
  workers: WorkerRecord[],
) {
  const customers: Record<string, unknown>[] = [];
  const properties: Record<string, unknown>[] = [];
  const quotes: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const chains: CustomerChain[] = [];

  for (let index = 0; index < input.customerCount; index += 1) {
    const number = String(index + 1).padStart(2, "0");
    const workerIndex = index % workers.length;
    const worker = workers[workerIndex];
    const customerId = randomUUID();
    const propertyId = randomUUID();
    const quoteId = randomUUID();
    const jobId = randomUUID();
    const customerName = `Simulation Customer ${number}`;
    const email = `ops-sim-${companyId.slice(0, 8)}-${runId}-customer-${number}@4everseasons.test`;
    const serviceMinutes = visitServiceMinutes(index);
    const collectClippings = visitCollectsClippings(index);
    const tax = money(input.weeklyPrice * 0.13);
    const total = money(input.weeklyPrice + tax);
    const city = CITY_ROTATION[index % CITY_ROTATION.length];

    customers.push({
      id: customerId,
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      full_name: customerName,
      email,
      phone: `905-555-${String(3000 + index).slice(-4)}`,
      notes: `${SIM_MARKER} Eight-week lawn-care customer created by the operational simulator.`,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
      archived_at: null,
    });
    properties.push({
      id: propertyId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      address_line1: `${100 + index} Simulation Route ${index % 4 + 1}`,
      city,
      province: "ON",
      postal_code: `L8S ${index % 10}A${index % 9 + 1}`,
      country: "Canada",
      lot_size: serviceMinutes === 20 ? "xs" : serviceMinutes === 30 ? "small" : "legacy",
      grass_height: ["2in", "3in", "4in", "5in"][index % 4],
      gate: index % 3 === 0,
      dog: index % 7 === 0,
      irrigation: index % 5 === 0,
      access_notes: `${SIM_MARKER} ${collectClippings ? "Collect clippings and leave bags by the green bin." : "Mulch clippings on site."}`,
      property_notes: `${serviceMinutes}-minute lawn profile assigned to ${worker.name}.`,
      geocode_status: "not_mapped",
      official_photo_url: null,
    });
    quotes.push({
      id: quoteId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: `SIM-${runId.toUpperCase()}-${number}`,
      status: "approved",
      subtotal: input.weeklyPrice,
      tax,
      total,
      notes: `Weekly Lawn Care · ${SIM_MARKER}`,
    });
    jobs.push({
      id: jobId,
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_id: quoteId,
      service_name: "Weekly Lawn Care",
      frequency: "weekly",
      service_frequency: "weekly",
      assigned_employee_id: worker.employeeId,
      crew_id: worker.crewId,
      active: true,
      next_visit_date: torontoDateKey(),
    });
    chains.push({ customerId, propertyId, quoteId, jobId, customerName, email, workerIndex, serviceMinutes, collectClippings });
  }

  return { customers, properties, quotes, jobs, chains };
}

async function createFeaturedCustomerLogin(
  service: any,
  companyId: string,
  chain: CustomerChain,
) {
  const password = `Fs!${randomBytes(12).toString("base64url")}4c`;
  const auth = await service.auth.admin.createUser({
    email: chain.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: chain.customerName,
      role: "customer",
      company_id: companyId,
      customer_id: chain.customerId,
      operational_simulation: true,
    },
  });
  if (auth.error || !auth.data.user) throw new Error(auth.error?.message || "Featured customer login could not be created.");
  const profileId = String(auth.data.user.id);
  const profile = await service.from("profiles").upsert({
    id: profileId,
    organization_id: companyId,
    company_id: companyId,
    role: "customer",
    full_name: chain.customerName,
    email: chain.email,
    active: true,
  }, { onConflict: "id" });
  if (profile.error) throw new Error(profile.error.message);
  const linked = await service.from("customers").update({ profile_id: profileId }).eq("id", chain.customerId);
  if (linked.error) throw new Error(linked.error.message);
  return { profileId, name: chain.customerName, email: chain.email, password };
}

function createCompletedOperations(
  companyId: string,
  input: OperationalSimulationInput,
  workers: WorkerRecord[],
  chains: CustomerChain[],
) {
  const routes: Record<string, unknown>[] = [];
  const visits: Record<string, unknown>[] = [];
  const photos: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  const lastVisits = new Map<string, string>();
  const today = torontoDateKey();
  const currentMonday = mondayOnOrBefore(today);
  const simulationStart = addDays(currentMonday, -input.weeks * 7);

  for (let week = 0; week < input.weeks; week += 1) {
    for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
      const worker = workers[workerIndex];
      const assigned = chains.filter(chain => chain.workerIndex === workerIndex);
      const dailyGroups = [assigned.slice(0, 8), assigned.slice(8, 16), assigned.slice(16, 23), assigned.slice(23, 30)];
      for (let dayIndex = 0; dayIndex < dailyGroups.length; dayIndex += 1) {
        const routeDate = addDays(simulationStart, week * 7 + dayIndex);
        const routeId = randomUUID();
        routes.push({
          id: routeId,
          organization_id: companyId,
          company_id: companyId,
          crew_id: worker.crewId,
          route_date: routeDate,
          status: "published",
        });
        let elapsedMinutes = 0;
        dailyGroups[dayIndex].forEach((chain, routeIndex) => {
          const visitId = randomUUID();
          const totalMinutes = chain.serviceMinutes + input.travelMinutesPerVisit + (chain.collectClippings ? input.clippingPickupMinutes : 0);
          const startedAt = isoAtMinutes(routeDate, elapsedMinutes);
          elapsedMinutes += totalMinutes;
          const finishedAt = isoAtMinutes(routeDate, elapsedMinutes);
          visits.push({
            id: visitId,
            organization_id: companyId,
            company_id: companyId,
            job_id: chain.jobId,
            route_id: routeId,
            customer_id: chain.customerId,
            property_id: chain.propertyId,
            crew_id: worker.crewId,
            assigned_employee_id: worker.employeeId,
            scheduled_date: routeDate,
            route_order: routeIndex + 1,
            status: "completed",
            started_at: startedAt,
            finished_at: finishedAt,
            duration_seconds: totalMinutes * 60,
            employee_notes: `${SIM_MARKER} ${chain.collectClippings ? "Clippings collected." : "Clippings mulched."}`,
            customer_visible_summary: "Lawn cut, edges trimmed and property left clean.",
          });
          photos.push({
            id: randomUUID(),
            organization_id: companyId,
            company_id: companyId,
            property_id: chain.propertyId,
            visit_id: visitId,
            uploaded_by: worker.profileId,
            storage_bucket: "work-photos",
            storage_path: `${companyId}/operational-simulation/after.svg`,
            public_url: null,
            photo_type: "after",
            caption: `${SIM_MARKER} Employee after-service evidence.`,
            sort_order: 1,
            is_profile: false,
          });
          if (week === input.weeks - 1) {
            notes.push({
              id: randomUUID(),
              organization_id: companyId,
              company_id: companyId,
              actor_profile_id: worker.profileId,
              action: "visit.employee_note",
              entity_type: "visit",
              entity_id: visitId,
              details: `${SIM_MARKER} Completed in ${totalMinutes} minutes. ${chain.collectClippings ? "Clippings collected." : "Mulched."}`,
              created_at: finishedAt,
            });
          }
          lastVisits.set(chain.customerId, visitId);
        });
      }
    }
  }

  const liveDate = today;
  for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
    const worker = workers[workerIndex];
    const assigned = chains.filter(chain => chain.workerIndex === workerIndex).slice(0, 4);
    const routeId = randomUUID();
    routes.push({
      id: routeId,
      organization_id: companyId,
      company_id: companyId,
      crew_id: worker.crewId,
      route_date: liveDate,
      status: "published",
    });
    assigned.forEach((chain, routeIndex) => {
      visits.push({
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        job_id: chain.jobId,
        route_id: routeId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        crew_id: worker.crewId,
        assigned_employee_id: worker.employeeId,
        scheduled_date: liveDate,
        route_order: routeIndex + 1,
        status: "scheduled",
        started_at: null,
        finished_at: null,
        duration_seconds: null,
      });
    });
  }

  return { routes, visits, photos, notes, lastVisits, simulationStart, simulationEnd: addDays(currentMonday, -4), liveDate };
}

async function initializeCanonicalRoutes(
  service: any,
  operations: ReturnType<typeof createCompletedOperations>,
  workers: WorkerRecord[],
  actorId: string,
) {
  const visitsByRoute = new Map<string, Record<string, unknown>[]>();
  for (const visit of operations.visits) {
    const routeId = String(visit.route_id || "");
    if (!routeId) throw new Error("Simulation Visit is missing routeId.");
    const rows = visitsByRoute.get(routeId) || [];
    rows.push(visit);
    visitsByRoute.set(routeId, rows);
  }
  const workerByCrew = new Map(workers.map(worker => [worker.crewId, worker]));

  for (const routeBatch of chunks(operations.routes, 8)) {
    await Promise.all(routeBatch.map(async route => {
      const routeId = String(route.id || "");
      const orderedVisitIds = (visitsByRoute.get(routeId) || [])
        .sort((left, right) => Number(left.route_order || 0) - Number(right.route_order || 0))
        .map(visit => String(visit.id || ""))
        .filter(Boolean);
      if (!routeId || !orderedVisitIds.length || new Set(orderedVisitIds).size !== orderedVisitIds.length) {
        throw new Error(`Simulation Route ${routeId || "unknown"} has an invalid canonical Visit order.`);
      }

      const worker = workerByCrew.get(String(route.crew_id || ""));
      const applied = await service.rpc("apply_canonical_route_order_v2_service", {
        p_route_id: routeId,
        p_ordered_visit_ids: orderedVisitIds,
        p_origin_label: `${worker?.name || "Employee"} start`,
        p_origin_latitude: null,
        p_origin_longitude: null,
        p_expected_version: null,
        p_actor_profile_id: actorId,
        p_source: "operational_simulator_initialization",
      });
      if (applied.error) {
        throw new Error(`Canonical Route ${routeId}: ${applied.error.message}`);
      }
      const savedOrder = Array.isArray(applied.data?.appliedOrder)
        ? applied.data.appliedOrder.map(String)
        : [];
      if (
        savedOrder.length !== orderedVisitIds.length
        || savedOrder.some((visitId: string, index: number) => visitId !== orderedVisitIds[index])
      ) {
        throw new Error(`Canonical Route ${routeId} did not confirm the exact simulation order.`);
      }
    }));
  }
}

function createBillingRows(
  companyId: string,
  runId: string,
  input: OperationalSimulationInput,
  chains: CustomerChain[],
  simulationStart: string,
) {
  const invoices: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const invoiceIdsByJob = new Map<string, string>();
  const periods = Math.max(1, Math.ceil(input.weeks / 4));

  chains.forEach((chain, customerIndex) => {
    for (let period = 0; period < periods; period += 1) {
      const invoiceId = randomUUID();
      const invoiceDate = addDays(simulationStart, period * 28 + 27);
      const coveredWeeks = Math.min(4, input.weeks - period * 4);
      const subtotal = money(input.weeklyPrice * coveredWeeks);
      const tax = money(subtotal * 0.13);
      const total = money(subtotal + tax);
      invoices.push({
        id: invoiceId,
        organization_id: companyId,
        company_id: companyId,
        quote_id: chain.quoteId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        invoice_number: `SIM-${runId.toUpperCase()}-${String(customerIndex + 1).padStart(2, "0")}-${period + 1}`,
        status: "paid",
        subtotal,
        tax,
        total,
        created_at: `${invoiceDate}T16:00:00.000Z`,
      });
      payments.push({
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        invoice_id: invoiceId,
        customer_id: chain.customerId,
        method: "credit_card",
        status: "paid",
        amount: total,
        reference: `SIM-PAY-${runId.toUpperCase()}-${customerIndex + 1}-${period + 1}`,
        notes: `${SIM_MARKER} Simulated successful customer payment. No Stripe activity.`,
        paid_at: `${invoiceDate}T16:05:00.000Z`,
        created_at: `${invoiceDate}T16:00:00.000Z`,
      });
      if (period === 0) invoiceIdsByJob.set(chain.jobId, invoiceId);
    }
  });

  return { invoices, payments, invoiceIdsByJob };
}

async function simulationStatus(service: any, companyId: string) {
  const pattern = simulationPattern(companyId);
  const customers = await service.from("customers").select("id")
    .or(companyFilter(companyId)).like("email", pattern).is("archived_at", null);
  if (customers.error) throw new Error(customers.error.message);
  const customerIds = (customers.data || []).map((row: any) => String(row.id));

  const workers = await service.from("profiles").select("id,full_name,email")
    .eq("role", "employee").or(companyFilter(companyId)).like("email", pattern);
  if (workers.error) throw new Error(workers.error.message);

  if (!customerIds.length) {
    return { exists: false, customerCount: 0, workers: [], completedVisits: 0, scheduledVisits: 0, photos: 0, paidInvoices: 0, collected: 0 };
  }

  const properties = await service.from("properties").select("id").in("customer_id", customerIds);
  if (properties.error) throw new Error(properties.error.message);
  const propertyIds = (properties.data || []).map((row: any) => String(row.id));
  const [visits, photos, invoices] = await Promise.all([
    service.from("visits").select("id,status").in("customer_id", customerIds).or(companyFilter(companyId)),
    propertyIds.length ? service.from("photos").select("id").in("property_id", propertyIds) : Promise.resolve({ data: [], error: null }),
    service.from("invoices").select("id,status,total").in("customer_id", customerIds),
  ]);
  if (visits.error) throw new Error(visits.error.message);
  if (photos.error) throw new Error(photos.error.message);
  if (invoices.error) throw new Error(invoices.error.message);
  const invoiceRows = invoices.data || [];

  return {
    exists: true,
    customerCount: customerIds.length,
    workers: workers.data || [],
    completedVisits: (visits.data || []).filter((row: any) => row.status === "completed").length,
    scheduledVisits: (visits.data || []).filter((row: any) => row.status === "scheduled").length,
    photos: (photos.data || []).length,
    paidInvoices: invoiceRows.filter((row: any) => row.status === "paid").length,
    collected: money(invoiceRows.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.total || 0), 0)),
  };
}

async function removeSimulation(service: any, companyId: string) {
  const pattern = simulationPattern(companyId);
  const customers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern);
  if (customers.error) throw new Error(customers.error.message);
  const customerIds = (customers.data || []).map((row: any) => String(row.id));

  const workerProfiles = await service.from("profiles").select("id")
    .eq("role", "employee").or(companyFilter(companyId)).like("email", pattern);
  if (workerProfiles.error) throw new Error(workerProfiles.error.message);
  const profileIds = [...new Set([
    ...(workerProfiles.data || []).map((row: any) => String(row.id)),
    ...(customers.data || []).map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),
  ])];

  if (!customerIds.length && !profileIds.length) return { customersRemoved: 0, accountsRemoved: 0 };

  const properties = customerIds.length ? await service.from("properties").select("id").in("customer_id", customerIds) : { data: [], error: null };
  if (properties.error) throw new Error(properties.error.message);
  const propertyIds = (properties.data || []).map((row: any) => String(row.id));
  const jobs = customerIds.length ? await service.from("jobs").select("id").in("customer_id", customerIds) : { data: [], error: null };
  if (jobs.error) throw new Error(jobs.error.message);
  const jobIds = (jobs.data || []).map((row: any) => String(row.id));
  const visits = customerIds.length ? await service.from("visits").select("id,route_id").in("customer_id", customerIds) : { data: [], error: null };
  if (visits.error) throw new Error(visits.error.message);
  const visitIds = (visits.data || []).map((row: any) => String(row.id));
  const routeIds = [...new Set((visits.data || []).map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];
  const employees = profileIds.length ? await service.from("employees").select("id,crew_id").in("profile_id", profileIds) : { data: [], error: null };
  if (employees.error) throw new Error(employees.error.message);
  const employeeIds = (employees.data || []).map((row: any) => String(row.id));
  const crewIds = [...new Set((employees.data || []).map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];

  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (result.error && !(optional && missingColumn(result.error.message))) {
      throw new Error(`${label}: ${result.error.message || "cleanup failed"}`);
    }
  }

  if (customerIds.length) {
    await remove("feedback", service.from("feedback").delete().in("customer_id", customerIds));
    await remove("tasks", service.from("tasks").delete().in("customer_id", customerIds));
    await remove("service_requests", service.from("service_requests").delete().in("customer_id", customerIds));
    await remove("payments", service.from("payments").delete().in("customer_id", customerIds), true);
  }
  if (visitIds.length) await remove("visit photos", service.from("photos").delete().in("visit_id", visitIds));
  if (propertyIds.length) await remove("property photos", service.from("photos").delete().in("property_id", propertyIds));
  if (routeIds.length) {
    await remove("route_stops", service.from("route_stops").delete().in("route_id", routeIds));
    await remove("employee_smart_route_state", service.from("employee_smart_route_state").delete().in("route_id", routeIds));
    await remove("route_order_state", service.from("route_order_state").delete().in("route_id", routeIds));
    await remove("route_map_cache", service.from("route_map_cache").delete().in("route_id", routeIds), true);
  }
  if (jobIds.length) await remove("job invoice links", service.from("jobs").update({ invoice_id: null }).in("id", jobIds), true);
  if (customerIds.length) {
    await remove("invoices", service.from("invoices").delete().in("customer_id", customerIds));
    await remove("visits", service.from("visits").delete().in("customer_id", customerIds));
  }
  if (routeIds.length) await remove("routes", service.from("routes").delete().in("id", routeIds));
  if (jobIds.length) await remove("jobs", service.from("jobs").delete().in("id", jobIds));
  if (customerIds.length) {
    await remove("quotes", service.from("quotes").delete().in("customer_id", customerIds));
    await remove("properties", service.from("properties").delete().in("customer_id", customerIds));
    await remove("customers", service.from("customers").delete().in("id", customerIds));
  }
  if (employeeIds.length) await remove("employees", service.from("employees").delete().in("id", employeeIds));
  if (crewIds.length) await remove("crews", service.from("crews").delete().in("id", crewIds));

  const storageDelete = await service.storage.from("work-photos").remove([`${companyId}/operational-simulation/after.svg`]);
  if (storageDelete.error && !/not found/i.test(storageDelete.error.message || "")) {
    throw new Error(`work-photos: ${storageDelete.error.message}`);
  }

  let accountsRemoved = 0;
  for (const profileId of profileIds) {
    const result = await service.auth.admin.deleteUser(profileId);
    if (result.error && !/not found/i.test(result.error.message)) {
      throw new Error(`auth cleanup: ${result.error.message}`);
    }
    accountsRemoved += 1;
  }

  return { customersRemoved: customerIds.length, accountsRemoved };
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    return NextResponse.json({
      status: await simulationStatus(service, companyId),
      preview: calculateOperationalSimulation(),
      source: "canonical-operational-simulation",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Simulation status failed." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, companyId, actorId } = await requireAdmin(request);
    const body = await request.json() as { action?: "create" | "remove"; assumptions?: Partial<OperationalSimulationInput> };

    if (body.action === "remove") {
      const removed = await removeSimulation(service, companyId);
      return NextResponse.json({ removed: true, ...removed, message: `${removed.customersRemoved} simulation customers and ${removed.accountsRemoved} temporary accounts removed.` });
    }

    const existing = await simulationStatus(service, companyId);
    if (existing.exists) throw new Error("An operational simulation already exists. Remove it before creating another one.");

    const input = normalizeOperationalSimulationInput({
      ...body.assumptions,
      customerCount: Math.min(60, Math.max(25, Number(body.assumptions?.customerCount || 60))),
      employeeCount: 2,
      weeks: 8,
      weeklyPrice: 40,
      maxHomesPerEmployee: 30,
      dailyCompanyCapacity: 15,
      workDaysPerWeek: 4,
    });
    const result = calculateOperationalSimulation(input);
    const runId = Date.now().toString(36);
    const workers: WorkerRecord[] = [];

    try {
      for (let index = 0; index < input.employeeCount; index += 1) {
        workers.push(await createWorker(service, companyId, runId, index));
      }

      const customerRows = createCustomerRows(companyId, runId, input, workers);
      await insertRowsWithFallback(service, "customers", customerRows.customers, [
        "service_company_id", "acquisition_source", "assignment_status", "offer_status", "platform_managed", "archived_at",
      ]);
      await insertRowsWithFallback(service, "properties", customerRows.properties, ["company_id", "geocode_status"]);
      await insertRowsWithFallback(service, "quotes", customerRows.quotes, ["company_id"]);
      await insertRowsWithFallback(service, "jobs", customerRows.jobs, ["company_id", "service_frequency", "assigned_employee_id", "crew_id"]);

      const featuredCustomer = await createFeaturedCustomerLogin(service, companyId, customerRows.chains[0]);
      const operations = createCompletedOperations(companyId, input, workers, customerRows.chains);
      await insertRowsWithFallback(service, "routes", operations.routes, ["company_id"]);
      await insertRowsWithFallback(service, "visits", operations.visits, ["company_id", "employee_notes", "customer_visible_summary"]);
      await initializeCanonicalRoutes(service, operations, workers, actorId);

      const photoStoragePath = `${companyId}/operational-simulation/after.svg`;
      const photoAsset = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#dce9f5"/><rect y="470" width="1200" height="330" fill="#4d8f4b"/><rect x="180" y="260" width="430" height="260" fill="#f4efe4"/><polygon points="140,280 395,90 650,280" fill="#744d3b"/><text x="60" y="735" font-family="Arial" font-size="42" fill="#ffffff">4Ever Seasons · Employee After-Service Photo · Simulation</text></svg>`;
      const uploadedPhoto = await service.storage.from("work-photos").upload(photoStoragePath, photoAsset, {
        contentType: "image/svg+xml",
        upsert: true,
      });
      if (uploadedPhoto.error) throw new Error(`work-photos: ${uploadedPhoto.error.message}`);
      await insertRowsWithFallback(service, "photos", operations.photos, ["company_id"]);

      const billing = createBillingRows(companyId, runId, input, customerRows.chains, operations.simulationStart);
      await insertRowsWithFallback(service, "invoices", billing.invoices, ["company_id"]);
      // Paid invoice status is the canonical simulated settlement. No Stripe or protected payments-table write occurs.

      for (const [jobId, invoiceId] of billing.invoiceIdsByJob) {
        const update = await service.from("jobs").update({ invoice_id: invoiceId }).eq("id", jobId);
        if (update.error && !missingColumn(update.error.message)) throw new Error(update.error.message);
      }

      // Feedback is intentionally submitted by the temporary Customer through the canonical portal RPC.
      const feedbackRows: Record<string, unknown>[] = [];

      // A real Return Visit Task is created later by the temporary Customer through create_customer_task.
      const taskRows: Record<string, unknown>[] = [];

      // The canonical audit trail remains attached to the company records themselves:
      // Customer notes, Visit execution notes, private Photos, Payments, Feedback and resolved Tasks.

      return NextResponse.json({
        created: true,
        result,
        operational: {
          simulationStart: operations.simulationStart,
          simulationEnd: operations.simulationEnd,
          liveDate: operations.liveDate,
          customerCount: customerRows.chains.length,
          workerCount: workers.length,
          completedVisits: input.customerCount * input.weeks,
          scheduledVisits: workers.length * 4,
          photoCount: operations.photos.length,
          invoiceCount: billing.invoices.length,
          paymentCount: billing.payments.length,
          feedbackCount: feedbackRows.length,
          taskCount: taskRows.length,
        },
        workers: workers.map(worker => ({ name: worker.name, email: worker.email, password: worker.password })),
        featuredCustomer: { name: featuredCustomer.name, email: featuredCustomer.email, password: featuredCustomer.password },
        message: `${input.customerCount} customers completed eight weeks of canonical lawn service. Two workers have live routes today for Start → Done testing.`,
      }, { status: 201 });
    } catch (error) {
      await removeSimulation(service, companyId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("admin-operational-simulator", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operational simulation failed." }, { status: 400 });
  }
}
