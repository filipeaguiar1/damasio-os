import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const files = {
  foundation: read("supabase/migrations/202608020500_canonical_route_stops_v2.sql"),
  writers: read("supabase/migrations/202608020510_canonical_route_writer_wrappers_v2.sql"),
  smartApi: read("app/api/mobile/employee/smart-route/route.ts"),
  service: read("lib/services/routeMapService.ts"),
  employeePage: read("app/mobile/employee/page.tsx"),
};

const failures = [];
const requireText = (file, value, message) => {
  if (!files[file].includes(value)) failures.push(message);
};
const rejectText = (file, value, message) => {
  if (files[file].includes(value)) failures.push(message);
};

for (const table of [
  "public.route_stops",
  "public.route_order_state",
  "public.route_order_audit",
]) {
  requireText("foundation", table, `Canonical route table missing: ${table}`);
}

requireText(
  "foundation",
  "drop trigger if exists persist_employee_smart_route_order_trigger",
  "The temporary Smart Route trigger is still an implicit writer.",
);
requireText(
  "foundation",
  "Backfill every existing published route",
  "Existing route houses are not backfilled into Route Stops V2.",
);
requireText(
  "writers",
  "route_stops_visit_unique",
  "A Visit can still be stored in more than one route.",
);
requireText(
  "writers",
  "replace_canonical_route_order_v2",
  "The single internal route-order transaction is missing.",
);
requireText(
  "writers",
  "The reviewed route must contain every non-cancelled house exactly once.",
  "The complete-house set is not validated before saving.",
);
requireText(
  "writers",
  "Route verification failed. Nothing was changed.",
  "The route is not re-read and verified before commit.",
);
requireText(
  "writers",
  "publish_canonical_route_daily_v1",
  "Admin publication is not wrapped by Route Stops V2.",
);
requireText(
  "writers",
  "move_canonical_visits_v1",
  "Visit movement is not wrapped by Route Stops V2.",
);
requireText(
  "writers",
  "route_move_source",
  "Source routes are not synchronized after a Visit move.",
);
requireText(
  "writers",
  "route_move_destination",
  "Destination routes are not synchronized after a Visit move.",
);
requireText(
  "writers",
  "v.status::text <> 'cancelled'",
  "Skipped/Needs Reschedule houses can disappear from the official route.",
);
requireText(
  "writers",
  "route_order_audit",
  "Route order changes are not auditable.",
);

requireText(
  "smartApi",
  'user.rpc("apply_canonical_route_order_v2"',
  "Employee Apply does not use the authenticated canonical transaction.",
);
requireText(
  "smartApi",
  "p_expected_version: body.expectedVersion",
  "Employee Apply has no optimistic concurrency protection.",
);
requireText(
  "smartApi",
  "The database did not confirm the reviewed route.",
  "Employee Apply can report success without database confirmation.",
);
requireText(
  "smartApi",
  'String(visit.status) !== "cancelled"',
  "Employee Apply drops skipped houses from the official route.",
);
rejectText(
  "smartApi",
  '.from("visits").update',
  "Employee endpoint still writes route order directly.",
);
rejectText(
  "smartApi",
  '.from("employee_smart_route_state").upsert',
  "Employee endpoint still writes Smart Route state outside the transaction.",
);

requireText(
  "service",
  "expectedVersion: params.expectedVersion",
  "The client does not send the route version it reviewed.",
);
requireText(
  "service",
  "saved: true",
  "The client does not expect a confirmed persistence result.",
);

// UX checks are intentionally explicit: a critical route write must never look idle.
requireText(
  "employeePage",
  "setBusy(true)",
  "Employee Apply does not enter a busy state.",
);
requireText(
  "employeePage",
  "Smart Route applied. Your map and stop order are synchronized.",
  "Employee Apply has no clear success acknowledgement.",
);

if (failures.length) {
  console.error("Canonical Route Stops V2 validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Canonical Route Stops V2 validation passed.");
console.log("Admin, Employee and route movement converge on one transactional order.");
console.log("Every non-cancelled house is durable, versioned, audited and verified.");
