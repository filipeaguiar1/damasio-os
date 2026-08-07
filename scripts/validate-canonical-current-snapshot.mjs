import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const currentReader = readFileSync("app/api/map/canonical-route-current/route.ts", "utf8");

assert.match(
  currentReader,
  /loadStrongSnapshot\(request\)/,
  "The current-route endpoint must return the shared strongly-consistent canonical snapshot.",
);
assert.match(
  currentReader,
  /return response;/,
  "The complete canonical response must be returned without rebuilding it.",
);
assert.match(
  currentReader,
  /Cache-Control.*no-store/,
  "The canonical current response cannot be cached.",
);
assert.doesNotMatch(
  currentReader,
  /createClient|route_order_state|employee_smart_route_state|route_stops|route_order_audit/,
  "The current-route wrapper cannot perform a second database read.",
);
assert.doesNotMatch(
  currentReader,
  /\.\.\.snapshot|Math\.max\(|routeVersion\s*,\s*origin/,
  "The wrapper cannot overlay a newer version or origin onto an older order.",
);

console.log("PASS canonical current snapshot remains indivisible");
