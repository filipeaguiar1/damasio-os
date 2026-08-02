import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The global snapshot regression is the authoritative map synchronization check.
await import("./validate-canonical-map-sync.mjs");

const read = path => readFileSync(path, "utf8");
const identity = read("lib/routes/canonicalRouteIdentity.ts");
const scheduling = read("lib/services/schedulingService.ts");
const repository = read("lib/repositories/schedulingRepository.ts");
const adminApi = read("app/api/admin/routes/route.ts");
const employeeApi = read("app/api/mobile/employee/route/route.ts");
const routeService = read("lib/services/routeMapService.ts");
const routeSnapshot = read("lib/routes/canonicalRouteSnapshot.ts");
const routeHook = read("lib/hooks/useCanonicalRouteSnapshot.ts");
const routeReader = read("app/api/map/canonical-route/route.ts");
const routeWriter = read("app/api/map/canonical-route/order/route.ts");
const routeMap = read("components/mobile/EmployeeRouteMap.tsx");
const visitMigration = read("supabase/migrations/202607270003_completed_visit_reopen_guard.sql");
const executionMigration = read("supabase/migrations/202607270004_visit_execution_state_invariants.sql");
const assignmentMigration = read("supabase/migrations/202607280001_route_assignment_modes.sql");
const canonicalMigration = read("supabase/migrations/202608020500_canonical_route_stops_v2.sql");
const serviceMigration = read("supabase/migrations/202608020555_canonical_route_service_apply_v2.sql");
const cleanupMigration = read("supabase/migrations/202608020700_canonical_route_snapshot_cleanup.sql");

for (const field of [
  "canonicalCustomerId",
  "canonicalPropertyId",
  "canonicalJobId",
  "canonicalVisitId",
  "canonicalRouteId",
  "canonicalEmployeeId",
  "canonicalCrewId",
]) {
  assert.ok(
    [identity, scheduling, routeService].some(source => source.includes(field)),
    `Canonical route field missing from integration: ${field}`,
  );
}

assert.match(identity, /belongsToCanonicalEmployee/, "Canonical Employee identity matching is missing.");
assert.match(scheduling, /normalizeVisitExecutionState/, "Scheduling must normalize Visit execution state.");
assert.match(repository, /canonicalWriterRequired/, "Legacy operational repository writers must remain blocked.");
assert.match(adminApi, /publish_canonical_route/, "Admin publication must use the canonical transaction.");
assert.match(adminApi, /assign_job_to_crew/, "Permanent Job assignment must use the canonical RPC.");
assert.match(employeeApi, /transition_visit_execution/, "Employee Visit actions must use the canonical transition RPC.");
assert.doesNotMatch(employeeApi, /\.ilike\("email"/, "Employee identity cannot fall back to email matching.");

assert.match(canonicalMigration, /route_stops is the durable source of truth/i);
assert.match(canonicalMigration, /All writes below are in this single database transaction/i);
assert.match(canonicalMigration, /Route verification failed\. Nothing was changed\./);
assert.match(canonicalMigration, /set route_order = s\.position/);
assert.match(canonicalMigration, /route_order_state/);
assert.match(canonicalMigration, /employee_smart_route_state/);
assert.match(serviceMigration, /apply_canonical_route_order_v2_service/);
assert.match(serviceMigration, /All writes below remain in this one database transaction/i);
assert.match(serviceMigration, /set route_order = s\.position/);
assert.match(serviceMigration, /route_order_state/);
assert.match(serviceMigration, /employee_smart_route_state/);

assert.match(routeReader, /from\("route_stops"\)/, "Canonical route reads must start at route_stops.");
assert.match(routeReader, /No projection fallback is allowed/, "Inconsistent canonical routes must fail closed.");
assert.doesNotMatch(routeReader, /route_map_cache/, "RouteId-only geometry cache cannot serve canonical snapshots.");
assert.match(routeReader, /roadGeometry\(String\(route\.id\), routeVersion, routePoints\)/, "Road geometry must be generated for the exact versioned stop sequence.");
assert.match(routeReader, /orderedVisitIds/);
assert.match(routeReader, /geometryStatus/);

assert.match(routeWriter, /service\.rpc\(\s*"apply_canonical_route_order_v2_service"/);
assert.match(routeWriter, /p_actor_profile_id: context\.profile\.id/);
assert.match(routeWriter, /context\.user\.rpc\(\s*"restore_canonical_route_order_v2"/);
assert.match(routeWriter, /A reviewed routeVersion is required/);
assert.match(routeWriter, /sameOrder\(savedOrder, orderedVisitIds\)/);
assert.doesNotMatch(routeWriter, /replace_canonical_route_order_v2/);

assert.match(routeSnapshot, /loadCanonicalRouteSnapshot/);
assert.match(routeSnapshot, /stop\.visitId === snapshot\.orderedVisitIds\[index\]/);
assert.match(routeHook, /table: "route_order_state"/);
assert.match(routeHook, /setInterval\(refreshCurrent, 5_000\)/);
assert.match(routeHook, /current\.routeVersion > next\.routeVersion/);
assert.match(routeService, /loadCanonicalRouteSnapshot\(\{ routeDate \}\)/);
assert.doesNotMatch(routeService, /\/api\/mobile\/employee\/(?:route|today-route)/);
assert.doesNotMatch(routeService, /localStorage|confirmedRouteOrders|canonicalRouteVersions|smartRoutePreviewVersions/);

assert.match(routeMap, /useCanonicalRouteSnapshot\(effectiveRouteId\)/);
assert.match(routeMap, /snapshot\.stops\.map/);
assert.match(routeMap, /snapshot\.geometry\.coordinates/);
assert.doesNotMatch(routeMap, /\/api\/map\/geocode|\/api\/map\/route|clientMapCache/);

for (const guard of [
  "visit_transition_audit",
  "transition_visit_execution",
  "reopen_completed_visit",
  "America/Toronto",
]) {
  assert.ok(visitMigration.includes(guard), `Visit guard missing: ${guard}`);
}
for (const guard of [
  "visits_execution_state_invariants",
  "enforce_visit_execution_state",
  "Start this Visit before finishing it.",
]) {
  assert.ok(executionMigration.includes(guard), `Execution invariant missing: ${guard}`);
}
for (const guard of [
  "visit_assignment_audit",
  "publish_canonical_route_daily",
  "move_canonical_visits",
  "temporary",
  "permanent",
]) {
  assert.ok(assignmentMigration.includes(guard), `Assignment guard missing: ${guard}`);
}

assert.match(cleanupMigration, /retired_55_york_demo/);
assert.match(cleanupMigration, /delete from public\.route_stops/);
assert.match(cleanupMigration, /delete from public\.visits/);
assert.match(cleanupMigration, /delete from public\.jobs/);
assert.match(cleanupMigration, /delete from public\.customers/);
assert.match(cleanupMigration, /alter publication supabase_realtime add table public\.route_order_state/);

console.log("Canonical Route validation passed.");
console.log("One route_stops order, one versioned snapshot, one service transaction and one shared map path are enforced.");
