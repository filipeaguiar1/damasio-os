import { randomBytes, randomUUID } from "node:crypto";
import {
  calculateOperationalSimulation,
  visitCollectsClippings,
  visitServiceMinutes,
  type OperationalSimulationInput,
} from "@/lib/simulator/operationalSimulator";
import {
  ADVANCED_SIMULATION_SCENARIOS,
  advancedSimulationActiveWeekOffsets,
  expectedAdvancedSimulationCounts,
  simulationCustomerNumber,
  simulationWorkerIndex,
  simulationWorkerName,
  type AdvancedSimulationScenarioKey,
  type AdvancedSimulationScope,
} from "@/lib/simulator/advancedSimulation";

const CITY_ROTATION = ["Hamilton", "Burlington", "Oakville"] as const;
const MAX_HISTORICAL_VISITS_PER_ROUTE = 10;
export const ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT = 6.2;

type ServiceClient = any;

export type AdvancedSimulationWorker = {
  profileId: string;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  password: string;
};

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

type GeneratedOperations = {
  routes: Record<string, unknown>[];
  visits: Record<string, unknown>[];
  photos: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  simulationStart: string;
  simulationEnd: string;
  liveDate: string;
};

export type AdvancedSimulationDataStatus = {
  exists: boolean;
  customerCount: number;
  workerCount: number;
  workers: Array<{ id: string; full_name: string | null; email: string | null }>;
  completedVisits: number;
  scheduledVisits: number;
  photos: number;
  paidInvoices: number;
  collected: number;
  protectedPayments: number;
  protectedPaymentAmount: number;
  routeCount: number;
  completedDurationSeconds: number;
};

export type AdvancedSimulationReconciliation = {
  passed: boolean;
  scenario: AdvancedSimulationScenarioKey;
  namespace: string;
  expected: ReturnType<typeof expectedAdvancedSimulationCounts>;
  visits: {
    expectedCompleted: number;
    actualCompleted: number;
    expectedScheduled: number;
    actualScheduled: number;
    passed: boolean;
  };
  invoices: {
    expectedCount: number;
    actualPaidCount: number;
    expectedSubtotal: number;
    actualCollected: number;
    expectedCollected: number;
    passed: boolean;
  };
  payments: {
    protectedLedgerCount: number;
    protectedLedgerAmount: number;
    modeledSettlementCount: number;
    modeledSettlementAmount: number;
    rule: string;
    passed: boolean;
  };
  payroll: {
    productiveHours: number;
    hourlyWage: number;
    burdenRate: number;
    modeledLoadedCost: number;
    source: string;
    passed: boolean;
  };
  km: {
    kmPerCompletedVisit: number;
    modeledKm: number;
    source: string;
    passed: boolean;
  };
  evidence: {
    expectedPhotos: number;
    actualPhotos: number;
    passed: boolean;
  };
};

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function missingColumn(message?: string) {
  return /(column|schema cache|does not exist)/i.test(message || "");
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

function isoAtMinutes(date: string, minutesAfterStart: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCMinutes(value.getUTCMinutes() + minutesAfterStart);
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

async function insertRows(client: ServiceClient, table: string, rows: Record<string, unknown>[]) {
  for (const batch of chunks(rows)) {
    const result = await client.from(table).insert(batch);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
  }
}

async function insertRowsWithFallback(
  client: ServiceClient,
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

async function createWorker(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  runId: string,
  index: number,
): Promise<AdvancedSimulationWorker> {
  const name = simulationWorkerName(index);
  const email = `${scope.emailPrefix}${runId}-worker-${index + 1}@4everseasons.test`;
  const password = `Fs!${randomBytes(12).toString("base64url")}7z`;
  const crewId = randomUUID();
  let profileId = "";

  try {
    const auth = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        role: "employee",
        company_id: scope.companyId,
        operational_simulation: true,
        operational_simulation_version: scope.version,
        operational_simulation_namespace: scope.namespace,
      },
    });
    if (auth.error || !auth.data.user) throw new Error(auth.error?.message || "Simulation worker login could not be created.");
    profileId = String(auth.data.user.id);

    await insertRows(service, "crews", [{
      id: crewId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
      name: `${scope.marker} ${name}`,
      active: true,
    }]);

    const common = {
      organization_id: scope.companyId,
      company_id: scope.companyId,
      full_name: name,
      email,
      address_line1: "71 Main St W, Hamilton, ON",
      route_start_address: "71 Main St W, Hamilton, ON",
      active: true,
      invite_status: "accepted",
      daily_route_capacity: MAX_HISTORICAL_VISITS_PER_ROUTE,
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

function createCustomerRows(
  scope: AdvancedSimulationScope,
  runId: string,
  input: OperationalSimulationInput,
  workers: AdvancedSimulationWorker[],
) {
  const customers: Record<string, unknown>[] = [];
  const properties: Record<string, unknown>[] = [];
  const quotes: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const chains: CustomerChain[] = [];

  for (let index = 0; index < input.customerCount; index += 1) {
    const number = simulationCustomerNumber(index, input.customerCount);
    const workerIndex = simulationWorkerIndex(index, workers.length);
    const worker = workers[workerIndex];
    const customerId = randomUUID();
    const propertyId = randomUUID();
    const quoteId = randomUUID();
    const jobId = randomUUID();
    const customerName = `Simulation ${scope.namespace} Customer ${number}`;
    const email = `${scope.emailPrefix}${runId}-customer-${number}@4everseasons.test`;
    const serviceMinutes = visitServiceMinutes(index);
    const collectClippings = visitCollectsClippings(index);
    const tax = money(input.weeklyPrice * 0.13);
    const total = money(input.weeklyPrice + tax);
    const city = CITY_ROTATION[index % CITY_ROTATION.length];

    customers.push({
      id: customerId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
      service_company_id: scope.companyId,
      full_name: customerName,
      email,
      phone: `905-555-${String(3000 + index).slice(-4)}`,
      notes: `${scope.marker} Canonical advanced operational simulation customer.`,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
      archived_at: null,
    });
    properties.push({
      id: propertyId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
      customer_id: customerId,
      address_line1: `${100 + index} ${scope.namespace} Simulation Route`,
      city,
      province: "ON",
      postal_code: `L8S ${index % 10}A${index % 9 + 1}`,
      country: "Canada",
      lot_size: serviceMinutes === 20 ? "xs" : serviceMinutes === 30 ? "small" : "legacy",
      grass_height: ["2in", "3in", "4in", "5in"][index % 4],
      gate: index % 3 === 0,
      dog: index % 7 === 0,
      irrigation: index % 5 === 0,
      access_notes: `${scope.marker} ${collectClippings ? "Collect clippings and leave bags by the green bin." : "Mulch clippings on site."}`,
      property_notes: `${serviceMinutes}-minute lawn profile assigned to ${worker.name}.`,
      geocode_status: "not_mapped",
      official_photo_url: null,
    });
    quotes.push({
      id: quoteId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: `SIM2-${runId.toUpperCase()}-${number}`,
      status: "approved",
      subtotal: input.weeklyPrice,
      tax,
      total,
      notes: `Weekly Lawn Care · ${scope.marker}`,
    });
    jobs.push({
      id: jobId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
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
  service: ServiceClient,
  scope: AdvancedSimulationScope,
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
      company_id: scope.companyId,
      customer_id: chain.customerId,
      operational_simulation: true,
      operational_simulation_version: scope.version,
      operational_simulation_namespace: scope.namespace,
    },
  });
  if (auth.error || !auth.data.user) throw new Error(auth.error?.message || "Featured customer login could not be created.");
  const profileId = String(auth.data.user.id);
  const profile = await service.from("profiles").upsert({
    id: profileId,
    organization_id: scope.companyId,
    company_id: scope.companyId,
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

function historicalRouteGroups(rows: CustomerChain[]) {
  return chunks(rows, MAX_HISTORICAL_VISITS_PER_ROUTE);
}

function createOperations(
  scope: AdvancedSimulationScope,
  scenarioKey: AdvancedSimulationScenarioKey,
  input: OperationalSimulationInput,
  workers: AdvancedSimulationWorker[],
  chains: CustomerChain[],
): GeneratedOperations {
  const scenario = ADVANCED_SIMULATION_SCENARIOS[scenarioKey];
  const routes: Record<string, unknown>[] = [];
  const visits: Record<string, unknown>[] = [];
  const photos: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  const today = torontoDateKey();
  const currentMonday = mondayOnOrBefore(today);
  const horizonStart = addDays(currentMonday, -scenario.horizonWeeks * 7);
  const activeOffsets = advancedSimulationActiveWeekOffsets(scenarioKey);

  activeOffsets.forEach((weekOffset, activeWeekIndex) => {
    for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
      const worker = workers[workerIndex];
      const assigned = chains.filter(chain => chain.workerIndex === workerIndex);
      const groups = historicalRouteGroups(assigned);
      groups.forEach((group, dayIndex) => {
        const routeDate = addDays(horizonStart, weekOffset * 7 + dayIndex);
        const routeId = randomUUID();
        routes.push({
          id: routeId,
          organization_id: scope.companyId,
          company_id: scope.companyId,
          crew_id: worker.crewId,
          route_date: routeDate,
          status: "published",
        });
        let elapsedMinutes = 0;
        group.forEach((chain, routeIndex) => {
          const visitId = randomUUID();
          const totalMinutes = chain.serviceMinutes + input.travelMinutesPerVisit + (chain.collectClippings ? input.clippingPickupMinutes : 0);
          const startedAt = isoAtMinutes(routeDate, elapsedMinutes);
          elapsedMinutes += totalMinutes;
          const finishedAt = isoAtMinutes(routeDate, elapsedMinutes);
          visits.push({
            id: visitId,
            organization_id: scope.companyId,
            company_id: scope.companyId,
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
            employee_notes: `${scope.marker} ${chain.collectClippings ? "Clippings collected." : "Clippings mulched."}`,
            customer_visible_summary: "Lawn cut, edges trimmed and property left clean.",
          });
          photos.push({
            id: randomUUID(),
            organization_id: scope.companyId,
            company_id: scope.companyId,
            property_id: chain.propertyId,
            visit_id: visitId,
            uploaded_by: worker.profileId,
            storage_bucket: "work-photos",
            storage_path: `${scope.storagePrefix}/after.svg`,
            public_url: null,
            photo_type: "after",
            caption: `${scope.marker} Employee after-service evidence.`,
            sort_order: 1,
            is_profile: false,
          });
          if (activeWeekIndex === activeOffsets.length - 1) {
            notes.push({
              id: randomUUID(),
              organization_id: scope.companyId,
              company_id: scope.companyId,
              actor_profile_id: worker.profileId,
              action: "visit.employee_note",
              entity_type: "visit",
              entity_id: visitId,
              details: `${scope.marker} Completed in ${totalMinutes} minutes. ${chain.collectClippings ? "Clippings collected." : "Mulched."}`,
              created_at: finishedAt,
            });
          }
        });
      });
    }
  });

  for (let workerIndex = 0; workerIndex < workers.length; workerIndex += 1) {
    const worker = workers[workerIndex];
    const assigned = chains
      .filter(chain => chain.workerIndex === workerIndex)
      .slice(0, scenario.liveVisitsPerEmployee);
    const routeId = randomUUID();
    routes.push({
      id: routeId,
      organization_id: scope.companyId,
      company_id: scope.companyId,
      crew_id: worker.crewId,
      route_date: today,
      status: "published",
    });
    assigned.forEach((chain, routeIndex) => {
      visits.push({
        id: randomUUID(),
        organization_id: scope.companyId,
        company_id: scope.companyId,
        job_id: chain.jobId,
        route_id: routeId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        crew_id: worker.crewId,
        assigned_employee_id: worker.employeeId,
        scheduled_date: today,
        route_order: routeIndex + 1,
        status: "scheduled",
        started_at: null,
        finished_at: null,
        duration_seconds: null,
      });
    });
  }

  return {
    routes,
    visits,
    photos,
    notes,
    simulationStart: horizonStart,
    simulationEnd: addDays(currentMonday, -7),
    liveDate: today,
  };
}

async function initializeCanonicalRoutes(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  operations: GeneratedOperations,
  workers: AdvancedSimulationWorker[],
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

  for (const routeBatch of chunks(operations.routes, 12)) {
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
        p_source: scope.source,
      });
      if (applied.error) throw new Error(`Canonical Route ${routeId}: ${applied.error.message}`);
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
  scope: AdvancedSimulationScope,
  runId: string,
  input: OperationalSimulationInput,
  chains: CustomerChain[],
  simulationStart: string,
) {
  const invoices: Record<string, unknown>[] = [];
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
        organization_id: scope.companyId,
        company_id: scope.companyId,
        quote_id: chain.quoteId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        invoice_number: `SIM2-${runId.toUpperCase()}-${simulationCustomerNumber(customerIndex, input.customerCount)}-${period + 1}`,
        status: "paid",
        subtotal,
        tax,
        total,
        created_at: `${invoiceDate}T16:00:00.000Z`,
      });
      if (period === 0) invoiceIdsByJob.set(chain.jobId, invoiceId);
    }
  });

  return { invoices, invoiceIdsByJob };
}

function expectedInvoiceTotals(input: OperationalSimulationInput) {
  const periods = Math.max(1, Math.ceil(input.weeks / 4));
  let perCustomerSubtotal = 0;
  let perCustomerCollected = 0;
  for (let period = 0; period < periods; period += 1) {
    const coveredWeeks = Math.min(4, input.weeks - period * 4);
    const subtotal = money(input.weeklyPrice * coveredWeeks);
    perCustomerSubtotal += subtotal;
    perCustomerCollected += money(subtotal + money(subtotal * 0.13));
  }
  return {
    invoiceCount: input.customerCount * periods,
    subtotal: money(perCustomerSubtotal * input.customerCount),
    collected: money(perCustomerCollected * input.customerCount),
  };
}

export async function createAdvancedSimulationData(
  service: ServiceClient,
  options: {
    scope: AdvancedSimulationScope;
    scenarioKey: AdvancedSimulationScenarioKey;
    input: OperationalSimulationInput;
    actorId: string;
    runId: string;
  },
) {
  const { scope, scenarioKey, input, actorId, runId } = options;
  const workers: AdvancedSimulationWorker[] = [];

  for (let index = 0; index < input.employeeCount; index += 1) {
    workers.push(await createWorker(service, scope, runId, index));
  }

  const customerRows = createCustomerRows(scope, runId, input, workers);
  await insertRowsWithFallback(service, "customers", customerRows.customers, [
    "service_company_id", "acquisition_source", "assignment_status", "offer_status", "platform_managed", "archived_at",
  ]);
  await insertRowsWithFallback(service, "properties", customerRows.properties, ["company_id", "geocode_status"]);
  await insertRowsWithFallback(service, "quotes", customerRows.quotes, ["company_id"]);
  await insertRowsWithFallback(service, "jobs", customerRows.jobs, ["company_id", "service_frequency", "assigned_employee_id", "crew_id"]);

  const featuredCustomer = await createFeaturedCustomerLogin(service, scope, customerRows.chains[0]);
  const operations = createOperations(scope, scenarioKey, input, workers, customerRows.chains);
  await insertRowsWithFallback(service, "routes", operations.routes, ["company_id"]);
  await insertRowsWithFallback(service, "visits", operations.visits, ["company_id", "employee_notes", "customer_visible_summary"]);
  await initializeCanonicalRoutes(service, scope, operations, workers, actorId);

  const photoAsset = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#dce9f5"/><rect y="470" width="1200" height="330" fill="#4d8f4b"/><rect x="180" y="260" width="430" height="260" fill="#f4efe4"/><polygon points="140,280 395,90 650,280" fill="#744d3b"/><text x="60" y="735" font-family="Arial" font-size="42" fill="#ffffff">4Ever Seasons · Employee After-Service Photo · Simulation V2</text></svg>`;
  const uploadedPhoto = await service.storage.from("work-photos").upload(`${scope.storagePrefix}/after.svg`, photoAsset, {
    contentType: "image/svg+xml",
    upsert: true,
  });
  if (uploadedPhoto.error) throw new Error(`work-photos: ${uploadedPhoto.error.message}`);
  await insertRowsWithFallback(service, "photos", operations.photos, ["company_id"]);

  const billing = createBillingRows(scope, runId, input, customerRows.chains, operations.simulationStart);
  await insertRowsWithFallback(service, "invoices", billing.invoices, ["company_id"]);
  // Simulation settlement remains represented by canonical paid Invoices. The protected
  // payments ledger is intentionally not forged without a provider-confirmed event.
  for (const [jobId, invoiceId] of billing.invoiceIdsByJob) {
    const update = await service.from("jobs").update({ invoice_id: invoiceId }).eq("id", jobId);
    if (update.error && !missingColumn(update.error.message)) throw new Error(update.error.message);
  }

  return {
    preview: calculateOperationalSimulation(input),
    operational: {
      simulationStart: operations.simulationStart,
      simulationEnd: operations.simulationEnd,
      liveDate: operations.liveDate,
      customerCount: customerRows.chains.length,
      workerCount: workers.length,
      completedVisits: operations.visits.filter(row => row.status === "completed").length,
      scheduledVisits: operations.visits.filter(row => row.status === "scheduled").length,
      routeCount: operations.routes.length,
      photoCount: operations.photos.length,
      invoiceCount: billing.invoices.length,
      protectedPaymentCount: 0,
    },
    workers: workers.map(worker => ({ name: worker.name, email: worker.email, password: worker.password })),
    featuredCustomer: { name: featuredCustomer.name, email: featuredCustomer.email, password: featuredCustomer.password },
  };
}

export async function advancedSimulationDataStatus(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
): Promise<AdvancedSimulationDataStatus> {
  const customers = await service.from("customers").select("id")
    .or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).is("archived_at", null);
  if (customers.error) throw new Error(customers.error.message);
  const customerIds: string[] = (customers.data || []).map((row: any) => String(row.id));

  const workers = await service.from("profiles").select("id,full_name,email")
    .eq("role", "employee").eq("active", true).or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern);
  if (workers.error) throw new Error(workers.error.message);

  if (!customerIds.length) {
    return {
      exists: false,
      customerCount: 0,
      workerCount: (workers.data || []).length,
      workers: workers.data || [],
      completedVisits: 0,
      scheduledVisits: 0,
      photos: 0,
      paidInvoices: 0,
      collected: 0,
      protectedPayments: 0,
      protectedPaymentAmount: 0,
      routeCount: 0,
      completedDurationSeconds: 0,
    };
  }

  const properties = await service.from("properties").select("id").in("customer_id", customerIds);
  if (properties.error) throw new Error(properties.error.message);
  const propertyIds = (properties.data || []).map((row: any) => String(row.id));
  const [visits, photos, invoices, payments] = await Promise.all([
    service.from("visits").select("id,status,duration_seconds,route_id").in("customer_id", customerIds).or(companyFilter(scope.companyId)),
    propertyIds.length ? service.from("photos").select("id").in("property_id", propertyIds) : Promise.resolve({ data: [], error: null }),
    service.from("invoices").select("id,status,subtotal,total").in("customer_id", customerIds),
    service.from("payments").select("id,status,amount").in("customer_id", customerIds),
  ]);
  if (visits.error) throw new Error(visits.error.message);
  if (photos.error) throw new Error(photos.error.message);
  if (invoices.error) throw new Error(invoices.error.message);
  if (payments.error && !/permission denied|does not exist|schema cache/i.test(payments.error.message || "")) {
    throw new Error(payments.error.message);
  }

  const visitRows = visits.data || [];
  const invoiceRows = invoices.data || [];
  const paymentRows = payments.error ? [] : payments.data || [];
  const completedRows = visitRows.filter((row: any) => row.status === "completed");
  const routeIds = new Set(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean));

  return {
    exists: true,
    customerCount: customerIds.length,
    workerCount: (workers.data || []).length,
    workers: workers.data || [],
    completedVisits: completedRows.length,
    scheduledVisits: visitRows.filter((row: any) => row.status === "scheduled").length,
    photos: (photos.data || []).length,
    paidInvoices: invoiceRows.filter((row: any) => row.status === "paid").length,
    collected: money(invoiceRows.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.total || 0), 0)),
    protectedPayments: paymentRows.length,
    protectedPaymentAmount: money(paymentRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)),
    routeCount: routeIds.size,
    completedDurationSeconds: completedRows.reduce((sum: number, row: any) => sum + Number(row.duration_seconds || 0), 0),
  };
}

export async function reconcileAdvancedSimulation(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  scenarioKey: AdvancedSimulationScenarioKey,
  input: OperationalSimulationInput,
): Promise<AdvancedSimulationReconciliation> {
  const status = await advancedSimulationDataStatus(service, scope);
  const expected = expectedAdvancedSimulationCounts(scenarioKey);
  const invoiceExpected = expectedInvoiceTotals(input);
  const productiveHours = status.completedDurationSeconds / 3600;
  const loadedPayroll = productiveHours * input.hourlyWage * (1 + input.payrollBurdenRate);
  const modeledKm = status.completedVisits * ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT;

  const visitsPassed = status.completedVisits === expected.completedVisits
    && status.scheduledVisits === expected.scheduledVisits
    && status.customerCount === expected.customers
    && status.workerCount === expected.employees;
  const invoicePassed = status.paidInvoices === invoiceExpected.invoiceCount
    && Math.abs(status.collected - invoiceExpected.collected) < 0.02;
  const paymentsPassed = status.protectedPayments === 0 && status.protectedPaymentAmount === 0 && invoicePassed;
  const payrollPassed = visitsPassed && productiveHours > 0 && loadedPayroll > 0;
  const kmPassed = visitsPassed && modeledKm > 0;
  const evidencePassed = status.photos === expected.completedVisits;

  return {
    passed: visitsPassed && invoicePassed && paymentsPassed && payrollPassed && kmPassed && evidencePassed,
    scenario: scenarioKey,
    namespace: scope.namespace,
    expected,
    visits: {
      expectedCompleted: expected.completedVisits,
      actualCompleted: status.completedVisits,
      expectedScheduled: expected.scheduledVisits,
      actualScheduled: status.scheduledVisits,
      passed: visitsPassed,
    },
    invoices: {
      expectedCount: invoiceExpected.invoiceCount,
      actualPaidCount: status.paidInvoices,
      expectedSubtotal: invoiceExpected.subtotal,
      actualCollected: status.collected,
      expectedCollected: invoiceExpected.collected,
      passed: invoicePassed,
    },
    payments: {
      protectedLedgerCount: status.protectedPayments,
      protectedLedgerAmount: status.protectedPaymentAmount,
      modeledSettlementCount: status.paidInvoices,
      modeledSettlementAmount: status.collected,
      rule: "Paid Invoices model simulator settlement; protected payments remain zero unless a provider-confirmed event exists.",
      passed: paymentsPassed,
    },
    payroll: {
      productiveHours: money(productiveHours),
      hourlyWage: input.hourlyWage,
      burdenRate: input.payrollBurdenRate,
      modeledLoadedCost: money(loadedPayroll),
      source: "sum(completed Visits.duration_seconds) × hourly wage × payroll burden",
      passed: payrollPassed,
    },
    km: {
      kmPerCompletedVisit: ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
      modeledKm: money(modeledKm),
      source: "completed canonical Visits × configured simulator km/Visit assumption",
      passed: kmPassed,
    },
    evidence: {
      expectedPhotos: expected.completedVisits,
      actualPhotos: status.photos,
      passed: evidencePassed,
    },
  };
}

async function collectInBatches(
  service: ServiceClient,
  table: string,
  columns: string,
  field: string,
  ids: string[],
) {
  const rows: any[] = [];
  for (const batch of chunks(ids, 25)) {
    const result = await service.from(table).select(columns).in(field, batch);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    rows.push(...(result.data || []));
  }
  return rows;
}

export async function removeAdvancedSimulationData(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
) {
  const customerResult = await service.from("customers").select("id,profile_id")
    .or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).limit(5000);
  if (customerResult.error) throw new Error(customerResult.error.message);
  const customerIds = (customerResult.data || []).map((row: any) => String(row.id));

  const workerProfiles = await service.from("profiles").select("id")
    .eq("role", "employee").or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).limit(5000);
  if (workerProfiles.error) throw new Error(workerProfiles.error.message);
  const simulationEmployees = await service.from("employees").select("id,profile_id,crew_id")
    .or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).limit(5000);
  if (simulationEmployees.error) throw new Error(simulationEmployees.error.message);
  const simulationEmployeeRows = simulationEmployees.data || [];
  const profileIds: string[] = [...new Set<string>([
    ...(workerProfiles.data || []).map((row: any) => String(row.id)),
    ...(customerResult.data || []).map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),
    ...simulationEmployeeRows.map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),
  ])];

  if (!customerIds.length && !profileIds.length && !simulationEmployeeRows.length) {
    const storageDelete = await service.storage.from("work-photos").remove([`${scope.storagePrefix}/after.svg`]);
    if (storageDelete.error && !/not found/i.test(storageDelete.error.message || "")) {
      throw new Error(`work-photos: ${storageDelete.error.message}`);
    }
    return { customersRemoved: 0, accountsRemoved: 0, visitsRemoved: 0, routesRemoved: 0 };
  }

  const propertyRows = customerIds.length ? await collectInBatches(service, "properties", "id", "customer_id", customerIds) : [];
  const propertyIds = propertyRows.map((row: any) => String(row.id));
  const jobRows = customerIds.length ? await collectInBatches(service, "jobs", "id", "customer_id", customerIds) : [];
  const jobIds = jobRows.map((row: any) => String(row.id));
  const visitRows = customerIds.length ? await collectInBatches(service, "visits", "id,route_id", "customer_id", customerIds) : [];
  const visitIds = visitRows.map((row: any) => String(row.id));
  const visitRouteIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];
  const profileEmployeeRows = profileIds.length ? await collectInBatches(service, "employees", "id,profile_id,crew_id", "profile_id", profileIds) : [];
  const employeeRows = [...new Map(
    [...simulationEmployeeRows, ...profileEmployeeRows].map((row: any) => [String(row.id), row]),
  ).values()];
  const employeeIds = employeeRows.map((row: any) => String(row.id));
  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];
  const crewRouteRows = crewIds.length ? await collectInBatches(service, "routes", "id", "crew_id", crewIds) : [];
  const routeIds: string[] = [...new Set<string>([
    ...visitRouteIds,
    ...crewRouteRows.map((row: any) => row.id ? String(row.id) : ""),
  ].filter(Boolean))];

  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (!result.error) return true;
    const message = result.error.message || "cleanup failed";
    if (optional && (missingColumn(message) || /permission denied/i.test(message))) {
      console.warn(`advanced-operational-simulator cleanup skipped ${label}: ${message}`);
      return false;
    }
    throw new Error(`${label}: ${message}`);
  }

  async function removeByIds(label: string, table: string, field: string, ids: string[], optional = false) {
    let removed = true;
    for (const batch of chunks(ids, 25)) {
      const batchRemoved = await remove(label, service.from(table).delete().in(field, batch), optional);
      if (!batchRemoved && optional) return false;
      removed = batchRemoved && removed;
    }
    return removed;
  }

  async function updateByIds(label: string, table: string, values: Record<string, unknown>, field: string, ids: string[], optional = false) {
    let updated = true;
    for (const batch of chunks(ids, 25)) {
      const batchUpdated = await remove(label, service.from(table).update(values).in(field, batch), optional);
      if (!batchUpdated && optional) return false;
      updated = batchUpdated && updated;
    }
    return updated;
  }

  if (customerIds.length) {
    await removeByIds("feedback", "feedback", "customer_id", customerIds);
    await removeByIds("tasks", "tasks", "customer_id", customerIds);
    await removeByIds("service_requests", "service_requests", "customer_id", customerIds);
    await removeByIds("payments", "payments", "customer_id", customerIds, true);
  }
  if (propertyIds.length) await removeByIds("property photos", "photos", "property_id", propertyIds);
  if (routeIds.length) {
    await removeByIds("employee_smart_route_state", "employee_smart_route_state", "route_id", routeIds);
    await removeByIds("route_stops", "route_stops", "route_id", routeIds);
    await removeByIds("route_order_state", "route_order_state", "route_id", routeIds);
    await removeByIds("route_map_cache", "route_map_cache", "route_id", routeIds, true);
  }
  if (jobIds.length) await updateByIds("job invoice links", "jobs", { invoice_id: null }, "id", jobIds, true);
  if (customerIds.length) await removeByIds("invoices", "invoices", "customer_id", customerIds);

  let visitsDeleted = true;
  let visitsRemoved = 0;
  if (customerIds.length) {
    async function cleanupVisitBatch(batch: string[]): Promise<boolean> {
      const cleanup = await service.rpc("cleanup_operational_simulation_visits", {
        p_company_id: scope.companyId,
        p_customer_ids: batch,
      });
      if (!cleanup.error) {
        visitsRemoved += Number(cleanup.data?.visitCount || 0);
        return true;
      }
      const message = String(cleanup.error.message || "");
      if (/statement timeout/i.test(message) && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        const left = await cleanupVisitBatch(batch.slice(0, midpoint));
        const right = await cleanupVisitBatch(batch.slice(midpoint));
        return left && right;
      }
      if (/cleanup_operational_simulation_visits|schema cache|could not find the function|permission denied/i.test(message)) {
        return false;
      }
      throw new Error(`visits cleanup: ${message || "QA cleanup RPC failed"}`);
    }

    for (const batch of chunks<string>(customerIds, 4)) {
      if (await cleanupVisitBatch(batch)) continue;
      visitsDeleted = false;
      break;
    }
    if (!visitsDeleted) {
      visitsDeleted = await removeByIds("visits", "visits", "customer_id", customerIds, true);
      if (visitsDeleted) visitsRemoved = visitIds.length;
    }
  }

  let routesRemoved = 0;
  if (visitsDeleted && crewIds.length) {
    const cleanupRoutes = await service.rpc("cleanup_operational_simulation_routes", {
      p_company_id: scope.companyId,
      p_namespace: scope.namespace,
      p_crew_ids: crewIds,
    });
    if (cleanupRoutes.error) {
      throw new Error(`routes cleanup: ${cleanupRoutes.error.message || "protected QA Route cleanup failed"}`);
    }
    routesRemoved = Number(cleanupRoutes.data?.routeCount || 0);
  }

  const archivedAt = new Date().toISOString();
  if (customerIds.length) await updateByIds("archive customers", "customers", { archived_at: archivedAt }, "id", customerIds);
  if (jobIds.length) await updateByIds("deactivate jobs", "jobs", { active: false }, "id", jobIds);
  if (employeeIds.length) await updateByIds("deactivate employees", "employees", { active: false }, "id", employeeIds);
  if (crewIds.length) await updateByIds("deactivate crews", "crews", { active: false }, "id", crewIds);
  if (profileIds.length) await updateByIds("deactivate profiles", "profiles", { active: false }, "id", profileIds);

  const storageDelete = await service.storage.from("work-photos").remove([`${scope.storagePrefix}/after.svg`]);
  if (storageDelete.error && !/not found/i.test(storageDelete.error.message || "")) {
    throw new Error(`work-photos: ${storageDelete.error.message}`);
  }

  let accountsRemoved = 0;
  for (const profileId of profileIds) {
    let deleted = false;
    let lastMessage = "";
    for (let attempt = 0; attempt < 3 && !deleted; attempt += 1) {
      const result = await service.auth.admin.deleteUser(profileId);
      if (!result.error || /not found/i.test(result.error?.message || "")) {
        deleted = true;
        break;
      }
      lastMessage = result.error?.message || JSON.stringify(result.error) || "auth cleanup failed";
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (!deleted) throw new Error(`auth cleanup: ${lastMessage}`);
    accountsRemoved += 1;
  }

  return {
    customersRemoved: customerIds.length,
    accountsRemoved,
    visitsRemoved,
    routesRemoved,
  };
}
