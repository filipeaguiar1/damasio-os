import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonicalApi = readFileSync("app/api/map/canonical-route/route.ts", "utf8");
const canonicalWriter = readFileSync("app/api/map/canonical-route/order/route.ts", "utf8");
const geocodeApi = readFileSync("app/api/map/geocode/route.ts", "utf8");
const routeMap = readFileSync("components/mobile/EmployeeRouteMap.tsx", "utf8");
const routeService = readFileSync("lib/services/routeMapService.ts", "utf8");

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
  "Every client must read one canonical route_stops order with one visit projection fallback.",
);
assert.match(
  canonicalApi,
  /smartState\?\.active && sameOrder\(smartOrder, canonicalOrder\)/,
  "Legacy Smart Route state must never override the canonical ordered stops.",
);
assert.match(
  canonicalApi,
  /address: fullAddress\(property\)/,
  "Every canonical map stop must receive the same full address.",
);
assert.match(
  canonicalApi,
  /permanentlyRemoveRetiredDemoYork/,
  "The retired 55 York demo stop must be removed from the database, not only hidden on one map.",
);
assert.match(
  canonicalApi,
  /address === "55 york blvd" \|\| address === "55 york boulevard"/,
  "55 York cleanup must use an exact address match.",
);
assert.match(
  canonicalApi,
  /TEMP_DEMO_SANDBOX_V1/,
  "55 York cleanup must be limited to temporary demo records.",
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
  "Desktop maps must render their stop list from the same canonical snapshot as their markers.",
);
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
  "The browser service must not write only the legacy Smart Route state.",
);
assert.match(
  canonicalWriter,
  /apply_canonical_route_order_v2/,
  "The canonical writer must use the transactional route order RPC when available.",
);
assert.match(
  canonicalWriter,
  /from\("route_stops"\)/,
  "The compatibility fallback must persist the same order in route_stops.",
);
assert.match(
  canonicalWriter,
  /from\("visits"\)[\s\S]*route_order/,
  "The compatibility fallback must project the same order to visits.route_order.",
);
assert.match(
  canonicalWriter,
  /from\("route_order_state"\)/,
  "Every order change must increment the canonical route version.",
);
assert.match(
  canonicalWriter,
  /cleanup_demo_york/,
  "The canonical writer must expose a guarded cleanup for the retired demo stop.",
);

console.log("PASS canonical map synchronization regression checks");
