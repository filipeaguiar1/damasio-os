import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/202608050300_route_move_reindex_and_map_refresh.sql",
  "utf8",
);
const studio = readFileSync("components/admin/RouteStudio.tsx", "utf8");
const endpoint = readFileSync("app/api/admin/route-assignment/route.ts", "utf8");

assert.match(
  migration,
  /repair_canonical_route_membership_v3/,
  "Route move must have one canonical membership repair function.",
);
assert.match(
  migration,
  /replace_canonical_route_order_v2/,
  "Repair must converge through the canonical Route Stops writer.",
);
assert.match(
  migration,
  /route_move_source_v3[\s\S]*route_move_destination_v3/,
  "Source routes must be repaired before destination routes.",
);
assert.match(
  migration,
  /Temporary means this exact dated Visit only/,
  "Temporary movement must remain limited to the selected dated Visit.",
);
assert.match(
  migration,
  /job_id = any\(v_job_ids\)[\s\S]*scheduled_date >= v_min_date/,
  "Permanent movement must include future scheduled Visits for the Job.",
);
assert.match(
  migration,
  /queue_route_map_rebuild/,
  "Every membership repair must invalidate and rebuild map geometry.",
);
assert.match(
  migration,
  /row_number\(\) over \(order by s\.position\)/,
  "The migration must repair already broken non-sequential routes.",
);
assert.match(
  studio,
  /\.route-move-summary>\.btn\{background:#f8fff9!important/,
  "Move action must use the requested near-white treatment.",
);
assert.match(
  studio,
  /\.route-move-mode button\{[^}]*background:#f5fbf7/,
  "Temporary and Permanent choices must be light and readable.",
);
assert.match(
  endpoint,
  /user\.rpc\("move_canonical_visits"/,
  "The Admin endpoint must keep using the canonical database writer.",
);

console.log("Route move reindex and map refresh contract passed.");
