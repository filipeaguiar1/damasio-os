import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const files = {
  foundation: read("supabase/migrations/202608020500_canonical_route_stops_v2.sql"),
  writers: read("supabase/migrations/202608020510_canonical_route_writer_wrappers_v2.sql"),
  projection: read("supabase/migrations/202608020515_canonical_route_projection_constraint_v2.sql"),
  resetMigration: read("supabase/migrations/202608020520_canonical_route_reset_v2.sql"),
  stateMigration: read("supabase/migrations/202608020525_canonical_route_state_read_v2.sql"),
  rollout: read("supabase/migrations/202608020530_canonical_route_backfill_verify_v2.sql"),
  smartApi: read("app/api/mobile/employee/smart-route/route.ts"),
  service: read("lib/services/routeMapService.ts"),
  integrity: read("lib/routes/routeAssignmentIntegrity.ts"),
  resetService: read("lib/routes/resetCompanyRouteOwnership.ts"),
  resetApi: read("app/api/admin/routes/reset/route.ts"),
  operationStatus: read("lib/mobile/mobileOperationStatus.ts"),
  operationUi: read("components/mobile/MobileOperationStatus.tsx"),
  mobileLayout: read("app/mobile/layout.tsx"),
};

const failures = [];
const requireText = (file, value, message) => {
  if (!files[file].includes(value)) failures.push(message);
};
const rejectText = (file, value, message) => {
  if (files[file].includes(value)) failures.push(message);
};

for (const table of ["public.route_stops", "public.route_order_state", "public.route_order_audit"]) {
  requireText("foundation", table, `Canonical route table missing: ${table}`);
}
requireText("foundation", "drop trigger if exists persist_employee_smart_route_order_trigger", "The temporary Smart Route trigger is still an implicit writer.");
requireText("foundation", "Backfill every existing published route", "Existing route houses are not backfilled into Route Stops V2.");
requireText("writers", "route_stops_visit_unique", "A Visit can still be stored in more than one route.");
requireText("writers", "replace_canonical_route_order_v2", "The single internal route-order transaction is missing.");
requireText("writers", "The reviewed route must contain every non-cancelled house exactly once.", "The complete-house set is not validated before saving.");
requireText("writers", "Route verification failed. Nothing was changed.", "The route is not re-read and verified before commit.");
requireText("writers", "publish_canonical_route_daily_v1", "Admin publication is not wrapped by Route Stops V2.");
requireText("writers", "move_canonical_visits_v1", "Visit movement is not wrapped by Route Stops V2.");
requireText("writers", "route_move_source", "Source routes are not synchronized after a Visit move.");
requireText("writers", "route_move_destination", "Destination routes are not synchronized after a Visit move.");
requireText("writers", "v.status::text <> 'cancelled'", "Skipped/Needs Reschedule houses can disappear from the official route.");
requireText("writers", "route_order_audit", "Route order changes are not auditable.");
requireText("projection", "update public.visits\n  set route_order = null\n  where route_id = p_route_id;", "The projection does not clear cancelled Visit positions safely.");
requireText("projection", "Cancelled Visit positions were not cleared.", "Cancelled Visit projection safety is not verified.");
requireText("resetMigration", "reset_company_route_ownership_v2", "Route ownership reset is not transactional.");
requireText("resetMigration", "sync_canonical_route_stops_v2", "Reset routes are not synchronized after ownership is cleared.");
requireText("resetMigration", "status::text not in ('in_progress', 'completed')", "Route reset can discard active or completed work.");
requireText("stateMigration", "active = false", "Admin or movement changes do not invalidate a stale Employee Smart Route.");
requireText("stateMigration", "Always return one canonical state row", "The database can still fall through to stale local Smart Route state.");
requireText("stateMigration", "coalesce(state.version, 1)", "The state reader does not expose the current Route version.");
requireText("stateMigration", "v_state.route_version, 0) = v_version", "A stale Smart Route state can still be reported as active.");
requireText("rollout", "canonical_route_stops_v2_rollout", "Existing routes are not synchronized during rollout.");
requireText("rollout", "A non-cancelled Visit is missing its matching Route Stop.", "Rollout does not verify complete route membership.");
requireText("rollout", "A Route Stop does not match its Visit projection.", "Rollout does not verify the compatibility projection.");
requireText("rollout", "A populated Route is missing its canonical version state.", "Rollout does not verify route versions.");

requireText("smartApi", 'user.rpc("apply_canonical_route_order_v2"', "Employee Apply does not use the authenticated canonical transaction.");
requireText("smartApi", "p_expected_version: body.expectedVersion", "Employee Apply has no optimistic concurrency protection.");
requireText("smartApi", "The database did not confirm the reviewed route.", "Employee Apply can report success without database confirmation.");
requireText("smartApi", 'String(visit.status) !== "cancelled"', "Employee Apply drops skipped houses from the official route.");
rejectText("smartApi", '.from("visits").update', "Employee endpoint still writes route order directly.");
rejectText("smartApi", '.from("employee_smart_route_state").upsert', "Employee endpoint still writes Smart Route state outside the transaction.");
rejectText("integrity", ".update({", "A post-RPC integrity helper still mutates the database.");
rejectText("integrity", "findOrCreateRoute", "A verification helper still creates or chooses a second Route writer.");
requireText("integrity", '.from("route_stops")', "Post-RPC verification does not compare Route Stops.");
requireText("resetService", 'rpc(\n    "reset_company_route_ownership_v2"', "The reset service bypasses the canonical reset transaction.");
rejectText("resetService", '.from("visits")', "The reset service still mutates Visits outside the transaction.");
requireText("resetApi", "resetCompanyRouteOwnership(user, companyId", "The reset API is not using the authenticated canonical RPC client.");

requireText("service", "canonicalRouteVersions", "The reviewed Route version is not retained with the loaded map.");
requireText("service", 'rpc("get_canonical_route_order_v2"', "The map does not load its canonical Route version.");
requireText("service", "expectedVersion: reviewedVersion", "Apply does not send the exact reviewed Route version.");
requireText("service", "Refresh the route before applying this preview.", "Apply can continue without a reviewed Route version.");
requireText("service", "clearLegacySmartRouteStates", "Inactive database state can resurrect a local Smart Route.");
requireText("service", "smartRouteApplyInFlight", "Repeated Apply clicks are not guarded.");
requireText("service", "beginMobileOperation", "Route persistence does not announce its working state.");
requireText("service", "completeMobileOperation", "Route persistence does not announce confirmed success.");
requireText("service", "failMobileOperation", "Route persistence does not communicate rollback/error state.");
requireText("operationStatus", 'phase: "working" | "success" | "error" | "clear"', "The mobile operation status contract is incomplete.");
requireText("operationUi", 'aria-busy="true"', "The mobile save overlay is not accessible as busy.");
requireText("operationUi", 'role={status.phase === "error" ? "alert" : "status"}', "Mobile results are not announced accessibly.");
requireText("mobileLayout", "<MobileOperationStatus />", "The global mobile operation status is not mounted.");

if (failures.length) {
  console.error("Canonical Route Stops V2 validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Canonical Route Stops V2 validation passed.");
console.log("All existing routes are synchronized and globally verified during rollout.");
console.log("Admin, Employee, movement and reset converge on transactional route writers.");
console.log("Every non-cancelled house is durable, versioned, audited and verified.");
console.log("Stale database and local Smart Route states cannot override canonical order.");
console.log("Every Apply is bound to the Route version the worker reviewed.");
console.log("Post-write integrity checks are read-only and mobile writes communicate state.");
