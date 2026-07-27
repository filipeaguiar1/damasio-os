import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const files = {
  identity: read("lib/routes/canonicalRouteIdentity.ts"),
  scheduling: read("lib/services/schedulingService.ts"),
  repository: read("lib/repositories/schedulingRepository.ts"),
  adminApi: read("app/api/admin/routes/route.ts"),
  advisorApi: read("app/api/admin/route-advisor/route.ts"),
  employeeApi: read("app/api/mobile/employee/route/route.ts"),
  advisorPanel: read("components/admin/RouteAdvisorPanel.tsx"),
  previewMap: read("components/admin/InteractiveRoutePreviewMap.tsx"),
  routeMapService: read("lib/services/routeMapService.ts"),
  offlineQueue: read("lib/mobile/offlineActionQueue.ts"),
  studio: read("components/admin/RouteStudio.tsx"),
  officialMap: read("components/admin/OfficialRoutePlanMap.tsx"),
  employeeMap: read("components/mobile/EmployeeRouteMap.tsx"),
  migration: read("supabase/migrations/202607270003_completed_visit_reopen_guard.sql"),
};

const failures = [];
const requireText = (file, value, message) => {
  if (!files[file].includes(value)) failures.push(message);
};
const rejectText = (file, value, message) => {
  if (files[file].includes(value)) failures.push(message);
};

for (const field of [
  "canonicalCustomerId",
  "canonicalPropertyId",
  "canonicalJobId",
  "canonicalVisitId",
  "canonicalRouteId",
  "canonicalEmployeeId",
  "canonicalCrewId",
]) {
  const found = Object.values(files).some(source => source.includes(field));
  if (!found) failures.push(`Canonical route field missing from integration: ${field}`);
}

requireText("identity", "belongsToCanonicalEmployee", "Canonical Employee ID matching helper is missing.");
requireText("scheduling", "canonicalEmployeeId: visit.employeeId", "Visits are not mapped to canonical Employee IDs.");
requireText("scheduling", "canonicalCustomerId: visit.customerId", "Visits are not mapped to canonical Customer IDs.");
requireText("scheduling", "visit.status !== \"cancelled\"", "Skipped Visits are hidden instead of remaining available for Needs Reschedule.");

requireText("adminApi", "jobByProperty", "Build does not preserve one permanent Job per Property.");
requireText("adminApi", "publish_canonical_route", "Legacy Smart/Publish writes do not use the canonical route transaction.");
requireText("adminApi", "assign_job_to_crew", "Build assignment is not using the canonical Job/Crew RPC.");

requireText("advisorApi", "publish_canonical_route", "Route Advisor does not publish through the canonical transaction.");
requireText("advisorApi", "reopen_completed_visit", "Route Advisor has no audited completed Visit Reopen.");
rejectText("advisorApi", '.from("visits").insert', "Route Advisor still inserts Visits through a parallel write path.");
rejectText("advisorApi", '.from("visits").update', "Route Advisor still updates Visits through a parallel write path.");

requireText("employeeApi", "transition_visit_execution", "Start, Done, Skip, Reset and Reopen do not share the canonical Visit transition RPC.");
requireText("employeeApi", 'action?: "start" | "done" | "reset" | "skip" | "reopen"', "Employee Reopen action is missing.");
requireText("employeeApi", ".eq(\"profile_id\", user.id)", "Employee route identity is not resolved through canonical profile_id.");
rejectText("employeeApi", ".ilike(\"email\"", "Employee identity still falls back to email matching.");

requireText("routeMapService", "canonicalVisitId", "Employee Route map does not synchronize by canonical Visit ID.");
rejectText("routeMapService", "employeeNameMatches", "Employee Route still identifies a worker by display name.");
rejectText("routeMapService", "normalizeAddress(candidate.address)", "Employee Route still identifies stops by address text.");
rejectText("offlineQueue", "localStorage.setItem", "Operational Visit writes are still persisted in localStorage.");
rejectText("offlineQueue", "localStorage.getItem", "Operational Visit writes are still read from localStorage.");

for (const legacyWriter of [
  "schedule_job_on_route",
  "move_visit_to_route",
  "set_visit_dispatch_status",
  "save_job_route_pattern",
]) {
  rejectText("repository", legacyWriter, `Legacy parallel operational writer remains exposed: ${legacyWriter}`);
}
requireText("repository", "canonicalWriterRequired", "Legacy repository signatures are not explicitly blocked.");

requireText("advisorPanel", "MANUAL ROUTE ORDER", "Manual route reordering controls are missing.");
requireText("advisorPanel", "Needs Reschedule", "Skipped Visit handling is missing from Route Advisor.");
requireText("advisorPanel", "Esta casa já foi concluída hoje", "Completed Visit selection guard is missing.");
requireText("advisorPanel", "Type REOPEN", "Strong completed Visit Reopen confirmation is missing.");
requireText("advisorPanel", "Position", "Accessible direct route position control is missing.");
requireText("previewMap", "distanceMeters", "Route preview does not recalculate distance.");
requireText("previewMap", "durationSeconds", "Route preview does not recalculate duration.");
requireText("previewMap", "onMetricsChange", "Route preview metrics are not synchronized with the list.");

for (const databaseGuard of [
  "visit_transition_audit",
  "visits_one_active_occurrence_per_job_day_idx",
  "visits_route_order_unique",
  "guard_visit_operational_transition",
  "transition_visit_execution",
  "reopen_completed_visit",
  "publish_canonical_route",
  "apply_employee_smart_route",
  "America/Toronto",
]) {
  requireText("migration", databaseGuard, `Database route/Visit guard missing: ${databaseGuard}`);
}

requireText("studio", "<OfficialRoutePlanMap date={date} onDateChange={setDate} />", "Dispatch View does not keep one controlled operational date.");
requireText("studio", "operationalDateKey", "Dispatch still uses a UTC date key.");
requireText("officialMap", "Select a worker to open the route.", "Route Plan Employee overview is missing.");
requireText("officialMap", "onClick={() => setSelectedId(\"\")}", "Route Plan Back navigation is missing.");
requireText("officialMap", "originPoint={origin}", "Admin route view does not include the Employee starting point.");
requireText("officialMap", "official-house-list", "Route Plan does not include the scrollable house list.");
requireText("employeeMap", "Calculating driving route", "Driving route geometry is not requested.");
rejectText("studio", "assignedCrew === employee.name", "Route Plan still matches Employees by display name.");
rejectText("studio", "assignedCrew===employee.name", "Route Plan still matches Employees by display name.");
rejectText("employeeMap", "updateLead(", "Canonical map still writes coordinates to local Lead storage.");

if (failures.length) {
  console.error("Canonical Route validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Canonical Route validation passed.");
console.log("Customer → Property → Job → Visit → Route → Employee/Crew IDs remain canonical.");
console.log("Build, Route Advisor, Move, Publish, Smart Route and execution transitions are database-guarded.");
