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
  executionState: read("lib/visits/executionState.ts"),
  offlineQueue: read("lib/mobile/offlineActionQueue.ts"),
  studio: read("components/admin/RouteStudio.tsx"),
  officialMap: read("components/admin/OfficialRoutePlanMap.tsx"),
  officialStatus: read("components/admin/OfficialRouteStatus.tsx"),
  officialPanelsCss: read("components/admin/officialRoutePanels.module.css"),
  employeeMap: read("components/mobile/EmployeeRouteMap.tsx"),
  mobileAdminRoute: read("app/mobile/admin/routes/page.tsx"),
  customerHistory: read("app/customer/history/page.tsx"),
  customerMobile: read("app/mobile/customer/[section]/page.tsx"),
  customerNav: read("components/mobile/MobileCustomerNav.tsx"),
  customerVisitModal: read("components/customer/CustomerServiceVisitModal.tsx"),
  migration: read("supabase/migrations/202607270003_completed_visit_reopen_guard.sql"),
  executionMigration: read("supabase/migrations/202607270004_visit_execution_state_invariants.sql"),
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
requireText("scheduling", "normalizeVisitExecutionState", "Admin scheduling views do not normalize Visit execution state.");

requireText("adminApi", "jobByProperty", "Build does not preserve one permanent Job per Property.");
requireText("adminApi", "publish_canonical_route", "Legacy Smart/Publish writes do not use the canonical route transaction.");
requireText("adminApi", "assign_job_to_crew", "Build assignment is not using the canonical Job/Crew RPC.");
requireText("adminApi", "isDemoIdentity", "Operational routes can still create Employees from demo profiles.");
requireText("adminApi", "Treat legacy Demo 02/04 assignments as unassigned", "Legacy demo Job assignments are still exposed as real work.");
requireText("adminApi", "Legacy demo Visits are not operational work", "Legacy demo Visits can still appear in official routes.");

requireText("advisorApi", "publish_canonical_route", "Route Advisor does not publish through the canonical transaction.");
requireText("advisorApi", "reopen_completed_visit", "Route Advisor has no audited completed Visit Reopen.");
rejectText("advisorApi", '.from("visits").insert', "Route Advisor still inserts Visits through a parallel write path.");
rejectText("advisorApi", '.from("visits").update', "Route Advisor still updates Visits through a parallel write path.");

requireText("employeeApi", "transition_visit_execution", "Start, Done, Skip, Reset and Reopen do not share the canonical Visit transition RPC.");
requireText("employeeApi", "fallbackVisitTransition", "Employee execution has no safe fallback while the canonical migration is pending.");
requireText("employeeApi", "Start this Visit before finishing it.", "Employee API can still finish a Visit that was never started.");
requireText("employeeApi", 'action?: "start" | "done" | "reset" | "skip" | "reopen"', "Employee Reopen action is missing.");
requireText("employeeApi", '.eq("profile_id", user.id)', "Employee route identity is not resolved through canonical profile_id.");
rejectText("employeeApi", '.ilike("email"', "Employee identity still falls back to email matching.");
rejectText("employeeApi", "latitude,longitude", "Employee Route API still depends on optional Property coordinate columns instead of address geocoding fallback.");

requireText("executionState", "normalizeVisitExecutionState", "Shared Visit execution normalization is missing.");
requireText("executionState", 'status === "scheduled"', "Scheduled Visit timer cleanup is missing.");
requireText("executionState", 'status === "completed"', "Completed Visit invariant validation is missing.");
requireText("routeMapService", "canonicalVisitId", "Employee Route map does not synchronize by canonical Visit ID.");
requireText("routeMapService", "id: stop.visitId", "Canonical Employee screens still retain a legacy Lead ID that can revive stale local timers.");
requireText("routeMapService", "normalizeVisitExecutionState", "Employee Route does not normalize Visit execution state.");
rejectText("routeMapService", "stop.startedAt || lead?.visitStartedAt", "Canonical Visit timestamps still fall back to legacy local data.");
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

for (const executionGuard of [
  "visits_execution_state_invariants",
  "enforce_visit_execution_state",
  "Start this Visit before finishing it.",
  "started_at = null",
  "duration_seconds = null",
]) {
  requireText("executionMigration", executionGuard, `Visit execution invariant missing: ${executionGuard}`);
}

requireText("studio", "<OfficialRoutePlanMap date={date} onDateChange={setDate} />", "Dispatch View does not keep one controlled operational date.");
requireText("studio", "operationalDateKey", "Dispatch still uses a UTC date key.");
rejectText("officialMap", "official-worker-list", "Route Plan still renders the redundant Employee list over the overview map.");
requireText("officialMap", "mapRef.current?.remove()", "Route Plan does not destroy the old Leaflet instance before returning to overview.");
requireText("officialMap", 'onClick={() => setSelectedId("")}', "Route Plan Back navigation is missing.");
requireText("officialMap", "originPoint={origin}", "Admin route view does not include the Employee starting point.");
requireText("officialMap", "houseScroll", "Route Plan does not include the scrollable house panel.");
requireText("officialMap", "Boolean(item.canonicalRouteId)", "Admin Route Plan still shows assigned Visits that were never published.");
requireText("officialPanelsCss", "grid-template-rows: auto auto minmax(0, 1fr)", "The Employee house panel does not reserve a scrollable list area.");
requireText("officialStatus", "{row.completed}/{row.visits.length}", "Route Status does not show completed houses over the real daily total.");
rejectText("officialStatus", "dailyCapacity", "Route Status still compares work against Employee capacity instead of the published daily route.");
requireText("officialStatus", ".filter(row => row.visits.length > 0)", "Route Status still renders Employees with no route for the day.");
requireText("employeeMap", "Calculating driving route", "Driving route geometry is not requested.");
rejectText("studio", "assignedCrew === employee.name", "Route Plan still matches Employees by display name.");
rejectText("studio", "assignedCrew===employee.name", "Route Plan still matches Employees by display name.");
rejectText("employeeMap", "updateLead(", "Canonical map still writes coordinates to local Lead storage.");

requireText("mobileAdminRoute", "belongsToCanonicalEmployee", "Mobile Admin routes do not use canonical Employee identity.");
requireText("mobileAdminRoute", "item.canonicalRouteId", "Mobile Admin routes still show unpublished Employee work.");
requireText("mobileAdminRoute", "operationalDateKey", "Mobile Admin routes still use a UTC day key.");
rejectText("mobileAdminRoute", "assignedCrew===employee.name", "Mobile Admin routes still identify Employees by display name.");

requireText("customerHistory", "CustomerServiceVisitModal", "Desktop Customer history does not open the shared completed-service detail.");
requireText("customerHistory", "getPropertyPhotoHistory", "Desktop Customer history does not load Visit-linked photo history.");
requireText("customerMobile", "CustomerServiceVisitModal", "Mobile Customer history does not open the shared completed-service detail.");
requireText("customerMobile", "getPropertyPhotoHistory", "Mobile Customer history does not load Visit-linked photo history.");
requireText("customerVisitModal", 'type Tab = "service" | "photos" | "property"', "Customer completed-service detail is missing standardized tabs.");
requireText("customerVisitModal", "customer-visit-modal-close", "Customer completed-service detail has no accessible close control.");
requireText("customerNav", "return null", "The floating Customer navigation is still rendered.");

if (failures.length) {
  console.error("Canonical Route validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Canonical Route validation passed.");
console.log("Customer → Property → Job → Visit → Route → Employee/Crew IDs remain canonical.");
console.log("Visit status, timer, Admin progress, Employee actions and Customer history share one normalized execution state.");
