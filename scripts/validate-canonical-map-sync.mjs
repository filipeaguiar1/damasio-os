import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonicalApi = readFileSync("app/api/map/canonical-route/route.ts", "utf8");
const canonicalWriter = readFileSync("app/api/map/canonical-route/order/route.ts", "utf8");
const geocodeApi = readFileSync("app/api/map/geocode/route.ts", "utf8");
const routeMap = readFileSync("components/mobile/EmployeeRouteMap.tsx", "utf8");
const routeService = readFileSync("lib/services/routeMapService.ts", "utf8");
const demoSandbox = readFileSync("app/api/admin/demo-sandbox/route.ts", "utf8");
const adminWeb = readFileSync("components/admin/OfficialRoutePlanMap.tsx", "utf8");
const adminMobile = readFileSync("app/mobile/admin/routes/page.tsx", "utf8");
const employeeWeb = readFileSync("app/employee/route/page.tsx", "utf8");
const employeeMobile = readFileSync("app/mobile/employee/page.tsx", "utf8");

assert.doesNotMatch(
  canonicalApi,
  /properties\([^)]*latitude[^)]*longitude[^)]*\)/,
  "Canonical route API must not require optional property coordinate columns.",
);
assert.match(
  canonicalApi,
  /properties\(address_line1,city,province,postal_code\)/,
  "Canonical route API must load the complete property address.",
);
assert.match(
  canonicalApi,
  /const canonicalOrder = routeStopOrder\.length === visits\.length \? routeStopOrder : visitProjection/,
  "Every client must read one route_stops order with one visit projection fallback.",
);
assert.match(
  canonicalApi,
  /Number\(smartState\.route_version \|\| 0\) === canonicalVersion/,
  "Smart Route origin is valid only when it belongs to the current canonical version.",
);
assert.match(
  canonicalApi,
  /sameOrder\(smartOrder, canonicalOrder\)/,
  "Legacy Smart Route state must never override the canonical ordered stops.",
);
assert.match(
  canonicalApi,
  /address: fullAddress\(property\)/,
  "Every canonical map stop must receive the same full address.",
);
assert.doesNotMatch(
  canonicalApi,
  /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/,
  "The canonical route GET endpoint must be read-only and cannot race with open map tabs.",
);
assert.doesNotMatch(
  demoSandbox,
  /\["55 York Blvd"/,
  "Future demo sandboxes must not recreate the retired 55 York property.",
);
assert.match(
  canonicalApi,
  /address === "55 york blvd" \|\| address === "55 york boulevard"/,
  "A strict safety filter must hide any stale retired York demo row.",
);
assert.match(
  canonicalApi,
  /TEMP_DEMO_SANDBOX_V1/,
  "The safety filter must be limited to temporary demo data.",
);

assert.match(
  geocodeApi,
  /SERVICE_VIEWBOX = "-80\.35,43\.65,-79\.35,42\.85"/,
  "Ambiguous addresses must be constrained to the Hamilton-Burlington-Oakville service area.",
);
assert.match(
  geocodeApi,
  /if \(bounded\) url\.searchParams\.set\("bounded", "1"\)/,
  "Street-only addresses must use a bounded geocoder search.",
);
assert.match(
  geocodeApi,
  /cache: "no-store"/,
  "Corrected geocoding must not be replaced by an old daily cache result.",
);

assert.match(
  routeMap,
  /\/api\/map\/canonical-route\?routeId=/,
  "Every shared map must read the canonical route snapshot.",
);
assert.match(
  routeMap,
  /setInterval\(\(\) => void loadSnapshot\(\), 5_000\)/,
  "Admin and Employee maps must poll the same route version every five seconds.",
);
assert.match(
  routeMap,
  /employee-canonical-route-list/,
  "Desktop maps must render their stop list from the same snapshot as their markers.",
);

for (const [label, source] of [
  ["Admin web", adminWeb],
  ["Admin mobile", adminMobile],
  ["Employee web", employeeWeb],
  ["Employee mobile", employeeMobile],
]) {
  assert.match(
    source,
    /EmployeeRouteMap/,
    `${label} must render the shared canonical map component.`,
  );
}

assert.match(
  routeService,
  /\/api\/map\/canonical-route\?routeId=/,
  "Employee route lists must use the same canonical snapshot as the map.",
);
assert.match(
  routeService,
  /stop\.address \|\| stop\.addressLine1/,
  "Employee views must prefer the canonical full address over a street-only fallback.",
);
assert.match(
  routeService,
  /\/api\/map\/canonical-route\/order/,
  "Smart Route changes must use the global canonical order writer.",
);
assert.doesNotMatch(
  routeService,
  /rpc\("apply_employee_smart_route"/,
  "The browser must not write only the legacy Smart Route state.",
);

assert.match(
  canonicalWriter,
  /apply_canonical_route_order_v2/,
  "The canonical writer must use the authenticated transactional wrapper when available.",
);
assert.match(
  canonicalWriter,
  /replace_canonical_route_order_v2/,
  "The compatibility path must use the database transaction that writes route_stops and visits together.",
);
assert.doesNotMatch(
  canonicalWriter,
  /from\("route_stops"\)\.(?:insert|upsert|update|delete)/,
  "The API must never manually rewrite route_stops outside the canonical database transaction.",
);
assert.match(
  canonicalWriter,
  /route_version: input\.version/,
  "Smart Route state must be stamped with the same canonical version.",
);
assert.equal(
  canonicalWriter.includes('verified.currentOrder.join("|")'),
  true,
  "Every compatibility write must verify the stored canonical order before returning success.",
);

console.log("PASS canonical map synchronization regression checks");
