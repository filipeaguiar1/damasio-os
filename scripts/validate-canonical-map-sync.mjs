import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonicalApi = readFileSync("app/api/map/canonical-route/route.ts", "utf8");
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
  /preferredOrder[\s\S]*smartOrder\.length \? smartOrder : routeStopOrder/,
  "Active Smart Route order must override the published fallback order.",
);
assert.match(
  canonicalApi,
  /address: fullAddress\(property\)/,
  "Every canonical map stop must receive the same full address.",
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

console.log("PASS canonical map synchronization regression checks");
