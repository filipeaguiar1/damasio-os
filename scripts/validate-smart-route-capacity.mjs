import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const smartRoute = read("app/api/mobile/employee/smart-route/route.ts");
const employeeApi = read("app/api/admin/users/route.ts");
const adminWeb = read("app/admin/employees/page.tsx");
const adminMobile = read("app/mobile/admin/employees/page.tsx");
const capacityMigration = read(
  "supabase/migrations/202608050200_remove_employee_capacity_ceiling.sql",
);

assert.match(
  smartRoute,
  /function scalableRoadOrder\(/,
  "Smart Route must use the scalable optimizer.",
);
assert.match(
  smartRoute,
  /OSRM_TABLE_BATCH_SIZE/,
  "Large routes must build the road matrix in provider-safe batches.",
);
assert.match(
  smartRoute,
  /sources=\$\{sources\}/,
  "Matrix batching must specify source subsets.",
);
assert.match(
  smartRoute,
  /destinations=\$\{destinations\}/,
  "Matrix batching must specify destination subsets.",
);
assert.doesNotMatch(
  smartRoute,
  /supports up to \d+ houses/i,
  "Smart Route cannot impose a fixed house count.",
);
assert.doesNotMatch(
  smartRoute,
  /1\s*<<\s*count|new Float64Array\(size \* width\)/,
  "Exponential exact-route allocation is forbidden.",
);
assert.doesNotMatch(
  employeeApi,
  /dailyRouteCapacity:[^\n]+\.max\(/,
  "Employee API capacity cannot have a fixed maximum.",
);
assert.doesNotMatch(
  adminWeb,
  /Math\.min\(60|max="60"/,
  "Admin web cannot clamp capacity to 60.",
);
assert.doesNotMatch(
  adminMobile,
  /Math\.min\(60|max="60"/,
  "Admin mobile cannot clamp capacity to 60.",
);
assert.match(
  capacityMigration,
  /check \(daily_route_capacity >= 1\)/,
  "Database capacity must remain positive.",
);
assert.doesNotMatch(
  capacityMigration,
  /least\(60/,
  "Database synchronization cannot restore the old ceiling.",
);

console.log("PASS Smart Route scalable capacity contract");
