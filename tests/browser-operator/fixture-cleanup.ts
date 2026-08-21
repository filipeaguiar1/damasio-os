import { expect } from "@playwright/test";
import type { SupabaseAny } from "./fixture-env";
import {
  countByIds,
  countCompanyRows,
  safeDelete,
  selectCompanyIds,
  unique,
} from "./fixture-db";
import type { OperatorFixture } from "./fixture-types";

export async function cleanupMutableOperatorFixture(db: SupabaseAny, fixture: OperatorFixture | null) {
  if (!fixture) return;
  const ids = await discoverMutableIds(db, fixture.companyId);
  const routeIds = unique([...fixture.created.routeIds, ...ids.routeIds]);
  const visitIds = unique([...fixture.created.visitIds, ...ids.visitIds]);
  const customerIds = unique([...fixture.created.customerIds, ...ids.customerIds]);
  const propertyIds = unique([...fixture.created.propertyIds, ...ids.propertyIds]);
  const jobIds = unique([...fixture.created.jobIds, ...ids.jobIds]);
  const profileIds = unique([...fixture.created.profileIds, ...ids.profileIds]);

  const photos = propertyIds.length
    ? await db.from("photos").select("id,storage_path").in("property_id", propertyIds)
    : { data: [], error: null };
  if (!photos.error) {
    for (const photo of photos.data || []) {
      if (photo.storage_path) fixture.created.storagePaths.push(String(photo.storage_path));
    }
  }

  await safeDelete(db, "route_map_rebuild_queue", "route_id", routeIds);
  await safeDelete(db, "route_map_cache", "route_id", routeIds);
  await safeDelete(db, "employee_smart_route_state", "route_id", routeIds);
  await safeDelete(db, "route_order_audit", "route_id", routeIds);
  await safeDelete(db, "route_order_state", "route_id", routeIds);
  await safeDelete(db, "route_stops", "route_id", routeIds);
  await safeDelete(db, "visit_route_removal_audit", "visit_id", visitIds);
  await safeDelete(db, "visit_billing_events", "visit_id", visitIds);
  await safeDelete(db, "feedback", "customer_id", customerIds);
  await safeDelete(db, "tasks", "customer_id", customerIds);
  await safeDelete(db, "photos", "property_id", propertyIds);

  if (customerIds.length) {
    const visitsCleanup = await db.rpc("cleanup_operational_simulation_visits", {
      p_company_id: fixture.companyId,
      p_customer_ids: customerIds,
    });
    if (visitsCleanup.error) throw new Error(`visits cleanup RPC: ${visitsCleanup.error.message}`);
  }

  const routesCleanup = await db.rpc("cleanup_operational_simulation_routes", {
    p_company_id: fixture.companyId,
    p_namespace: fixture.cleanupNamespace,
    p_crew_ids: [fixture.employee.crewId],
  });
  if (routesCleanup.error) throw new Error(`routes cleanup RPC: ${routesCleanup.error.message}`);

  await safeDelete(db, "lead_center", "id", fixture.created.leadIds);

  // Browser Operator customer emails are deliberately scoped as
  // ops-sim-<company>-browser-...@4everseasons.test. Reuse the existing
  // security-definer purge instead of weakening DELETE protection on core tables.
  const corePurge = await db.rpc("purge_operational_simulation_v1_run", {
    p_company_id: fixture.companyId,
    p_run_id: "browser",
  });
  if (corePurge.error) throw new Error(`browser core purge RPC: ${corePurge.error.message}`);

  await safeDelete(db, "employees", "id", [fixture.employee.employeeId]);
  await safeDelete(db, "crews", "id", [fixture.employee.crewId]);
  await safeDelete(db, "profiles", "id", profileIds);
  await safeDelete(db, "organizations", "id", [fixture.companyId]);

  const storagePaths = unique(fixture.created.storagePaths).filter(path => path.startsWith(fixture.companyId));
  if (storagePaths.length) await db.storage.from("work-photos").remove(storagePaths).catch(() => undefined);
  for (const userId of unique(fixture.created.userIds)) {
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

export async function assertNoMutableResidue(db: SupabaseAny, fixture: OperatorFixture) {
  const counts: Record<string, number> = {};
  for (const table of ["customers", "properties", "service_requests", "quotes", "jobs", "routes", "visits", "photos", "employees", "crews", "profiles"]) {
    const result = await countCompanyRows(db, table, fixture.companyId);
    counts[table] = result;
  }
  const stopCount = fixture.created.routeIds.length
    ? await countByIds(db, "route_stops", "route_id", fixture.created.routeIds)
    : 0;
  counts.route_stops = stopCount;
  expect(counts, `QA Browser Operator cleanup left residue for ${fixture.namespace}`).toEqual(
    Object.fromEntries(Object.keys(counts).map(key => [key, 0])),
  );
}

async function discoverMutableIds(db: SupabaseAny, companyId: string) {
  const [routes, visits, jobs, properties, customers, profiles] = await Promise.all([
    selectCompanyIds(db, "routes", companyId),
    selectCompanyIds(db, "visits", companyId),
    selectCompanyIds(db, "jobs", companyId),
    selectCompanyIds(db, "properties", companyId),
    selectCompanyIds(db, "customers", companyId),
    selectCompanyIds(db, "profiles", companyId),
  ]);
  return {
    routeIds: routes,
    visitIds: visits,
    jobIds: jobs,
    propertyIds: properties,
    customerIds: customers,
    profileIds: profiles,
  };
}
