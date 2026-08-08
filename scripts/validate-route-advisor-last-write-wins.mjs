import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/admin/route-advisor/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202608031100_lock_active_canonical_route_order.sql", "utf8");
const materializeStart = route.indexOf("async function materializePublishedRoute");
const materializeEnd = route.indexOf("export async function POST", materializeStart);
assert.ok(materializeStart >= 0 && materializeEnd > materializeStart, "Route materialization helper must exist.");
const materialize = route.slice(materializeStart, materializeEnd);

assert.doesNotMatch(materialize, /from\("route_stops"\)/, "Route Advisor must not directly rewrite protected route_stops.");
assert.doesNotMatch(materialize, /from\("route_order_state"\)/, "Route Advisor must not pre-increment canonical route state.");
assert.doesNotMatch(materialize, /from\("visits"\)\s*\.update/, "Route Advisor must not maintain a parallel Visit order writer.");
assert.match(route, /service\.rpc\("apply_canonical_route_order_v2_service"/, "Route Advisor must finish through the protected canonical writer.");
assert.match(route, /p_expected_version:\s*null/, "Admin publication must use intentional last-write-wins semantics.");
assert.match(migration, /set_config\('damasio\.canonical_route_write',\s*'1',\s*true\)/, "The canonical writer must keep its transaction-local authorization.");
assert.match(migration, /where id = p_route_id\s+for update/, "The canonical writer must serialize competing publications on the Route row.");

console.log("PASS Route Advisor replaces the canonical route atomically; the latest Admin publication wins");
