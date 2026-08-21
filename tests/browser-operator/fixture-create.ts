import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { nextWeekday, torontoDate, type SupabaseAny } from "./fixture-env";
import { insertRowsWithFallback, upsertRowsWithFallback } from "./fixture-db";
import type { OperatorFixture } from "./fixture-types";

export async function createMutableOperatorFixture(db: SupabaseAny, baseNamespace: string) {
  expect(baseNamespace).toMatch(/^qa_/i);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const namespace = `${baseNamespace}_browser_operator_${suffix}`.replace(/[^a-z0-9_-]/gi, "_");
  const companyId = randomUUID();
  const companyToken = companyId.slice(0, 8).toLowerCase();
  const cleanupNamespace = `browser-${suffix}`.replace(/[^a-z0-9-]/g, "-").slice(0, 32).replace(/-+$/g, "");
  expect(cleanupNamespace).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  const crewId = randomUUID();
  const employeeId = randomUUID();
  const primaryCustomerId = randomUUID();
  const primaryPropertyId = randomUUID();
  const routeDate = nextWeekday(1);
  const secondRouteDate = torontoDate(daysBetween(routeDate, 1));
  const staleSundayDate = torontoDate(daysBetween(routeDate, -1));
  const oldPublishedDate = torontoDate(daysBetween(routeDate, 2));
  const password = `QaBrowser!${Date.now()}Aa1`;
  const adminEmail = `${namespace}.admin@4everseasons.test`;
  const employeeEmail = `ops-sim-v2-${companyToken}-${cleanupNamespace}-employee@4everseasons.test`;
  const customerEmail = `ops-sim-${companyToken}-browser-${suffix}.customer@4everseasons.test`;
  const created = {
    userIds: [] as string[],
    profileIds: [] as string[],
    customerIds: [] as string[],
    propertyIds: [] as string[],
    requestIds: [] as string[],
    leadIds: [] as string[],
    quoteIds: [] as string[],
    jobIds: [] as string[],
    routeIds: [] as string[],
    visitIds: [] as string[],
    storagePaths: [] as string[],
  };

  const adminProfileId = await createAuthUser(db, adminEmail, password, "QA Browser Admin", created);
  const employeeProfileId = await createAuthUser(db, employeeEmail, password, "QA Browser Employee", created);
  const customerProfileId = await createAuthUser(db, customerEmail, password, "QA Browser Customer", created);

  await insertRowsWithFallback(db, "organizations", [{
    id: companyId,
    name: `QA Browser Operator ${namespace}`,
    slug: namespace.replace(/_/g, "-").slice(0, 62),
    active: true,
    plan_name: "qa",
    contact_email: adminEmail,
  }], ["active", "plan_name", "contact_email"]);

  await upsertRowsWithFallback(db, "profiles", [
    roleProfile(adminProfileId, companyId, "admin", "QA Browser Admin", adminEmail, { phone: "+19055550100" }),
    roleProfile(employeeProfileId, companyId, "employee", "QA Browser Employee", employeeEmail, {
      address_line1: "1 King Street West, Hamilton, ON",
      route_start_address: "1 King Street West, Hamilton, ON",
      daily_route_capacity: 18,
    }),
    roleProfile(customerProfileId, companyId, "customer", "QA Browser Customer", customerEmail),
  ], ["company_id", "address_line1", "route_start_address", "daily_route_capacity", "manager_permissions", "phone"]);

  await insertRowsWithFallback(db, "crews", [{
    id: crewId,
    organization_id: companyId,
    company_id: companyId,
    name: `${namespace} Crew`,
    active: true,
  }], ["company_id"]);

  await insertRowsWithFallback(db, "employees", [{
    id: employeeId,
    organization_id: companyId,
    company_id: companyId,
    profile_id: employeeProfileId,
    crew_id: crewId,
    full_name: "QA Browser Employee",
    email: employeeEmail,
    active: true,
    route_start_address: "1 King Street West, Hamilton, ON",
    address_line1: "1 King Street West, Hamilton, ON",
    daily_route_capacity: 18,
  }], ["company_id", "route_start_address", "address_line1", "daily_route_capacity"]);

  const hamiltonJobIds: string[] = [];
  const burlingtonJobIds: string[] = [];
  const jobFixtures = [
    ...Array.from({ length: 16 }, (_, index) => ({ city: "Hamilton", index: index + 1 })),
    ...Array.from({ length: 8 }, (_, index) => ({ city: "Burlington", index: index + 1 })),
  ];

  for (const item of jobFixtures) {
    const customerId = item.city === "Hamilton" && item.index === 1 ? primaryCustomerId : randomUUID();
    const propertyId = item.city === "Hamilton" && item.index === 1 ? primaryPropertyId : randomUUID();
    const requestId = randomUUID();
    const leadId = randomUUID();
    const quoteId = randomUUID();
    const jobId = randomUUID();
    created.customerIds.push(customerId);
    created.propertyIds.push(propertyId);
    created.requestIds.push(requestId);
    created.leadIds.push(leadId);
    created.quoteIds.push(quoteId);
    created.jobIds.push(jobId);
    if (item.city === "Hamilton") hamiltonJobIds.push(jobId);
    else burlingtonJobIds.push(jobId);

    await createJobStack(db, {
      companyId,
      companyToken,
      customerProfileId,
      customerEmail,
      namespace,
      suffix,
      item,
      routeDate,
      customerId,
      propertyId,
      requestId,
      leadId,
      quoteId,
      jobId,
    });
  }

  await seedStalePublishedVisit(db, {
    companyId,
    crewId,
    employeeId,
    customerId: created.customerIds[0],
    propertyId: created.propertyIds[0],
    jobId: hamiltonJobIds[0],
    routeDate: staleSundayDate,
    status: "scheduled",
    namespace,
    created,
  });
  await seedStalePublishedVisit(db, {
    companyId,
    crewId,
    employeeId,
    customerId: created.customerIds[1],
    propertyId: created.propertyIds[1],
    jobId: hamiltonJobIds[1],
    routeDate: oldPublishedDate,
    status: "scheduled",
    namespace,
    created,
  });

  return {
    namespace,
    cleanupNamespace,
    companyId,
    admin: { email: adminEmail, password, profileId: adminProfileId },
    employee: { email: employeeEmail, password, profileId: employeeProfileId, employeeId, crewId },
    customer: { email: customerEmail, password, profileId: customerProfileId, customerId: primaryCustomerId, propertyId: primaryPropertyId },
    routeDate,
    secondRouteDate,
    staleSundayDate,
    oldPublishedDate,
    hamiltonJobIds,
    burlingtonJobIds,
    jobIds: [...hamiltonJobIds, ...burlingtonJobIds],
    created,
  } satisfies OperatorFixture;
}

async function createJobStack(
  db: SupabaseAny,
  input: {
    companyId: string;
    companyToken: string;
    customerProfileId: string;
    customerEmail: string;
    namespace: string;
    suffix: string;
    item: { city: string; index: number };
    routeDate: string;
    customerId: string;
    propertyId: string;
    requestId: string;
    leadId: string;
    quoteId: string;
    jobId: string;
  },
) {
  const { item, namespace } = input;
  const address = `QA Simulation Route ${namespace} ${item.city} ${String(item.index).padStart(2, "0")}`;
  const email = item.index === 1 && item.city === "Hamilton"
    ? input.customerEmail
    : `ops-sim-${input.companyToken}-browser-${input.suffix}.${item.city.toLowerCase()}.${item.index}@4everseasons.test`;

  await insertRowsWithFallback(db, "customers", [{
    id: input.customerId,
    organization_id: input.companyId,
    company_id: input.companyId,
    service_company_id: input.companyId,
    profile_id: item.index === 1 && item.city === "Hamilton" ? input.customerProfileId : null,
    full_name: `QA ${item.city} Customer ${item.index} ${namespace}`,
    email,
    notes: namespace,
    assignment_status: "active",
    offer_status: "accepted",
    platform_managed: true,
  }], ["company_id", "service_company_id", "assignment_status", "offer_status", "platform_managed"]);

  await insertRowsWithFallback(db, "properties", [{
    id: input.propertyId,
    organization_id: input.companyId,
    company_id: input.companyId,
    customer_id: input.customerId,
    address_line1: address,
    city: item.city,
    province: "ON",
    postal_code: item.city === "Hamilton" ? "L8P 1A1" : "L7R 2E2",
    country: "Canada",
    lot_size: "small",
    grass_height: "3in",
    gate: false,
    dog: false,
    irrigation: false,
    property_notes: namespace,
    latitude: item.city === "Hamilton" ? 43.2557 + item.index / 10000 : 43.3255 + item.index / 10000,
    longitude: item.city === "Hamilton" ? -79.8711 - item.index / 10000 : -79.7990 - item.index / 10000,
    geocode_status: "mapped",
  }], ["company_id", "latitude", "longitude", "geocode_status"]);

  await insertRowsWithFallback(db, "service_requests", [{ id: input.requestId, organization_id: input.companyId, company_id: input.companyId, customer_id: input.customerId, property_id: input.propertyId, service_name: "QA Browser Operator Lawn Care", message: namespace, status: "quoted" }], ["company_id"]);
  await insertRowsWithFallback(db, "quotes", [{ id: input.quoteId, organization_id: input.companyId, company_id: input.companyId, request_id: input.requestId, customer_id: input.customerId, property_id: input.propertyId, quote_number: `QA-BO-${item.city.slice(0, 3).toUpperCase()}-${String(item.index).padStart(2, "0")}-${input.suffix}`, status: "approved", subtotal: 88.5, tax: 11.5, total: 100, notes: namespace, customer_email: email, acquisition_source: "company_created", master_reviewed_at: new Date().toISOString() }], ["company_id", "customer_email", "acquisition_source", "master_reviewed_at"]);
  await insertRowsWithFallback(db, "lead_center", [{ id: input.leadId, assigned_company_id: input.companyId, customer_id: input.customerId, property_id: input.propertyId, service_request_id: input.requestId, quote_id: input.quoteId, full_name: `QA ${item.city} Customer ${item.index}`, email, address, service_requested: "QA Browser Operator Lawn Care", status: "offered", final_total: 100 }], ["assigned_company_id", "service_request_id", "quote_id", "final_total"]);
  await insertRowsWithFallback(db, "jobs", [{ id: input.jobId, organization_id: input.companyId, company_id: input.companyId, customer_id: input.customerId, property_id: input.propertyId, quote_id: input.quoteId, service_name: "QA Browser Operator Lawn Care", frequency: item.city === "Hamilton" ? "weekly" : "biweekly", service_frequency: item.city === "Hamilton" ? "weekly" : "biweekly", active: true, next_visit_date: input.routeDate, recurrence_anchor_date: input.routeDate, contract_starts_on: input.routeDate, contract_ends_on: torontoDate(60) }], ["company_id", "service_frequency", "recurrence_anchor_date", "contract_starts_on", "contract_ends_on"]);
}

async function createAuthUser(db: SupabaseAny, email: string, password: string, fullName: string, created: OperatorFixture["created"]) {
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  expect(user.error, user.error?.message).toBeNull();
  const id = user.data.user?.id || "";
  expect(id).toBeTruthy();
  created.userIds.push(id);
  created.profileIds.push(id);
  return id;
}

function roleProfile(id: string, companyId: string, role: string, fullName: string, email: string, extra: Record<string, unknown> = {}) {
  return { id, organization_id: companyId, company_id: companyId, role, full_name: fullName, email, active: true, daily_route_capacity: 18, ...extra };
}

async function seedStalePublishedVisit(db: SupabaseAny, input: { companyId: string; crewId: string; employeeId: string; customerId: string; propertyId: string; jobId: string; routeDate: string; status: string; namespace: string; created: OperatorFixture["created"]; }) {
  const routeId = randomUUID();
  const visitId = randomUUID();
  input.created.routeIds.push(routeId);
  input.created.visitIds.push(visitId);
  await insertRowsWithFallback(db, "routes", [{ id: routeId, organization_id: input.companyId, company_id: input.companyId, crew_id: input.crewId, route_date: input.routeDate, status: "published" }], ["company_id"]);
  await insertRowsWithFallback(db, "visits", [{ id: visitId, organization_id: input.companyId, company_id: input.companyId, job_id: input.jobId, route_id: routeId, customer_id: input.customerId, property_id: input.propertyId, crew_id: input.crewId, assigned_employee_id: input.employeeId, scheduled_date: input.routeDate, status: input.status, route_order: 1, customer_visible_summary: input.namespace }], ["company_id", "route_order"]);
  await insertRowsWithFallback(db, "route_stops", [{ company_id: input.companyId, route_id: routeId, visit_id: visitId, position: 1 }], []);
  await insertRowsWithFallback(db, "route_order_state", [{ route_id: routeId, company_id: input.companyId, version: 1, last_source: "qa_browser_operator_stale_seed" }], ["last_source"]);
}

function daysBetween(dateKey: string, plusDays: number) {
  const today = new Date(`${torontoDate()}T12:00:00Z`);
  const target = new Date(`${dateKey}T12:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000) + plusDays;
}
