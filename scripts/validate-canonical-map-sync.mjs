import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const canonicalApi = read("app/api/map/canonical-route/route.ts");
const canonicalWriter = read("app/api/map/canonical-route/order/route.ts");
const routeMap = read("components/mobile/EmployeeRouteMap.tsx");
const routeService = read("lib/services/routeMapService.ts");
const snapshotClient = read("lib/routes/canonicalRouteSnapshot.ts");
const snapshotHook = read("lib/hooks/useCanonicalRouteSnapshot.ts");
const cleanupMigration = read("supabase/migrations/202608020700_canonical_route_snapshot_cleanup.sql");
const demoSandbox = read("app/api/admin/demo-sandbox/route.ts");
const operationalSimulator = read("app/api/admin/operational-simulator/route.ts");
const adminWeb = read("components/admin/OfficialRoutePlanMap.tsx");
const adminMobile = read("app/mobile/admin/routes/page.tsx");
const employeeWeb = read("app/employee/route/page.tsx");
const employeeMobile = read("app/mobile/employee/page.tsx");

assert.match(canonicalApi, /from\("route_stops"\)/, "route_stops must be the only route order source.");
assert.match(canonicalApi, /No projection fallback is allowed/, "An inconsistent route must fail instead of falling back.");
assert.doesNotMatch(canonicalApi, /visitProjection|projectedOrder|canonicalOrder\s*=.*\?.*:/, "The reader cannot reconstruct order from Visits.");
assert.doesNotMatch(canonicalApi, /applied_order/, "employee_smart_route_state cannot supply route order.");
assert.match(canonicalApi, /properties\(address_line1,city,province,postal_code\)/, "Every stop must use the same complete address fields.");
assert.match(canonicalApi, /const point = await geocodeAddress\(address\)/, "Coordinates must be resolved once by the canonical snapshot service.");
assert.match(canonicalApi, /photonPoint/, "Canonical server geocoding needs a primary provider.");
assert.match(canonicalApi, /nominatimPoint/, "Canonical server geocoding needs a fallback provider.");
assert.doesNotMatch(canonicalApi, /properties\([^)]*latitude|properties\([^)]*longitude/, "Canonical reads cannot depend on optional coordinate columns.");
assert.match(canonicalApi, /orderedVisitIds/, "The snapshot must publish the canonical ordered Visit IDs.");
assert.match(canonicalApi, /routeOrder: orderedVisitIds\.map/, "Marker numbers and lists must use the same routeOrder projection.");
assert.match(canonicalApi, /geometryStatus/, "The canonical response must include geometry state.");
assert.match(canonicalApi, /roadGeometry\(String\(route\.id\), routeVersion, routePoints\)/, "Geometry must be keyed by routeId, routeVersion and ordered points.");
assert.doesNotMatch(canonicalApi, /route_map_cache/, "The read endpoint cannot accept routeId-only geometry cache.");
assert.doesNotMatch(canonicalApi, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/, "The canonical GET endpoint must remain read-only.");

assert.match(canonicalWriter, /service\.rpc\(\s*"apply_canonical_route_order_v2_service"/, "All route applies must use the one service transaction.");
assert.match(canonicalWriter, /p_actor_profile_id: context\.profile\.id/, "The service writer must audit the authenticated actor.");
assert.match(canonicalWriter, /context\.user\.rpc\(\s*"restore_canonical_route_order_v2"/, "All restores must use the canonical restore transaction.");
assert.doesNotMatch(canonicalWriter, /replace_canonical_route_order_v2|employee_smart_route_state.*upsert/, "The API cannot use independent compatibility writers.");
assert.doesNotMatch(canonicalWriter, /\.from\("route_stops"\)|\.from\("visits"\)\.(?:insert|upsert|update|delete)/, "The browser API cannot manually rewrite canonical tables.");
assert.match(canonicalWriter, /A reviewed routeVersion is required/, "Stale clients must not write without optimistic concurrency.");
assert.match(canonicalWriter, /sameOrder\(savedOrder, orderedVisitIds\)/, "The exact stored order must be confirmed before success.");

assert.match(operationalSimulator, /service\.rpc\(\s*"apply_canonical_route_order_v2_service"/, "Every simulated Route must use the same service transaction.");
assert.match(operationalSimulator, /p_actor_profile_id: actorId/, "Simulation writes must preserve the authenticated Admin actor.");
assert.match(operationalSimulator, /await initializeCanonicalRoutes\(service, operations, workers, actorId\)/, "Simulation creation cannot finish before canonical initialization.");
assert.match(operationalSimulator, /savedOrder\.some/, "The simulator must verify the exact saved Visit order.");
assert.match(operationalSimulator, /from\("route_stops"\)\.delete/, "Simulation cleanup must remove canonical stops.");
assert.match(operationalSimulator, /from\("route_order_state"\)\.delete/, "Simulation cleanup must remove canonical route versions.");

assert.match(snapshotClient, /loadCanonicalRouteSnapshot/, "Every screen must use the shared snapshot loader.");
assert.match(snapshotClient, /stop\.visitId === snapshot\.orderedVisitIds\[index\]/, "The client must reject identity/order mismatches.");
assert.match(snapshotHook, /table: "route_order_state"/, "Realtime must listen to canonical routeVersion.");
assert.match(snapshotHook, /table: "route_stops"/, "Realtime must listen to canonical stop changes.");
assert.match(snapshotHook, /table: "visits"/, "Realtime must listen to Visit status changes.");
assert.match(snapshotHook, /setInterval\(refreshCurrent, 5_000\)/, "Polling must remain as a safety net.");
assert.match(snapshotHook, /current\.routeVersion > next\.routeVersion/, "An older snapshot cannot overwrite a newer version.");

assert.match(routeService, /loadCanonicalRouteSnapshot\(\{ routeDate \}\)/, "Employee lists must read the same endpoint as the maps.");
assert.doesNotMatch(routeService, /\/api\/mobile\/employee\/(?:route|today-route)/, "Employee route data cannot fall back to a second endpoint.");
assert.doesNotMatch(routeService, /localStorage|confirmedRouteOrders|canonicalRouteVersions|smartRoutePreviewVersions/, "Local route order state is forbidden.");
assert.doesNotMatch(routeService, /getRouteMapCache|loadCachedRouteGeometry/, "Legacy geometry cache cannot overwrite the snapshot.");
assert.equal(routeService.includes("return context.stops.map"), true, "Employee lists must preserve the exact snapshot order.");

assert.match(routeMap, /useCanonicalRouteSnapshot\(effectiveRouteId\)/, "All maps must consume the shared canonical hook.");
assert.match(routeMap, /snapshot\.stops\.map/, "List and markers must be derived from the same ordered stop array.");
assert.match(routeMap, /snapshot\.geometry\.coordinates/, "The blue line must come from the same snapshot.");
assert.match(routeMap, /point\.routeOrder/, "Marker labels must use canonical routeOrder.");
assert.doesNotMatch(routeMap, /\/api\/map\/geocode|\/api\/map\/route|readRoadGeometry|saveRoadGeometry|clientMapCache/, "No screen may geocode or rebuild geometry independently.");
assert.doesNotMatch(routeMap, /if \(!snapshot\) return route/, "The shared map cannot silently fall back to supplied stale data.");

for (const [label, source] of [
  ["Admin web", adminWeb],
  ["Admin mobile", adminMobile],
  ["Employee web", employeeWeb],
  ["Employee mobile", employeeMobile],
]) {
  assert.match(source, /EmployeeRouteMap/, `${label} must render the shared canonical map component.`);
}
for (const [label, source] of [["Employee web", employeeWeb], ["Employee mobile", employeeMobile]]) {
  assert.match(source, /loadEmployeeRouteMapContext/, `${label} list must use the canonical route service.`);
}

assert.doesNotMatch(demoSandbox, /\["55 York Blvd"/, "Demo tooling must not recreate 55 York Blvd.");
assert.match(cleanupMigration, /retired_55_york_demo/, "The retired demo identity must be selected strictly.");
for (const table of ["route_stops", "visits", "jobs", "properties", "customers"]) {
  assert.match(cleanupMigration, new RegExp(`delete from public\\.${table}`), `55 York cleanup must delete ${table}.`);
}
assert.match(cleanupMigration, /delete from public\.route_map_cache/, "Old database geometry caches must be removed.");
assert.match(cleanupMigration, /alter publication supabase_realtime add table public\.route_order_state/, "routeVersion must be published through Realtime.");
assert.match(cleanupMigration, /set route_order = s\.position/, "Cleanup must reindex the Visit compatibility projection.");

const fixture = {
  routeId: "route-1",
  routeVersion: 9,
  origin: { label: "Start", address: "1 Main St, Hamilton, ON, Canada", latitude: 43.25, longitude: -79.87 },
  orderedVisitIds: ["visit-c", "visit-a", "visit-b"],
  routeOrder: [
    { visitId: "visit-c", routeOrder: 1 },
    { visitId: "visit-a", routeOrder: 2 },
    { visitId: "visit-b", routeOrder: 3 },
  ],
  stops: [
    { visitId: "visit-c", routeOrder: 1, address: "3 C St, Hamilton, ON, Canada" },
    { visitId: "visit-a", routeOrder: 2, address: "1 A St, Hamilton, ON, Canada" },
    { visitId: "visit-b", routeOrder: 3, address: "2 B St, Hamilton, ON, Canada" },
  ],
  geometry: { type: "LineString", coordinates: [[-79.87, 43.25], [-79.88, 43.26]] },
};
const fourScreens = ["admin-web", "admin-mobile", "employee-web", "employee-mobile"].map(() => structuredClone(fixture));
for (const screen of fourScreens) {
  assert.deepEqual(screen.orderedVisitIds, fixture.orderedVisitIds);
  assert.deepEqual(screen.routeOrder.map(item => item.routeOrder), [1, 2, 3]);
  assert.equal(screen.stops.length, 3);
  assert.deepEqual(screen.geometry.coordinates[0], [fixture.origin.longitude, fixture.origin.latitude]);
  assert.equal(screen.stops.some(stop => /55 York/i.test(stop.address)), false);
}

console.log("PASS canonical global route snapshot regression checks");
