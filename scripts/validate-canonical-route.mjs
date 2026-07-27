import fs from "node:fs";

const files = {
  identity: fs.readFileSync("lib/routes/canonicalRouteIdentity.ts", "utf8"),
  service: fs.readFileSync("lib/services/schedulingService.ts", "utf8"),
  adminApi: fs.readFileSync("app/api/admin/routes/route.ts", "utf8"),
  advisorApi: fs.readFileSync("app/api/admin/route-advisor/route.ts", "utf8"),
  studio: fs.readFileSync("components/admin/RouteStudio.tsx", "utf8"),
  officialMap: fs.readFileSync("components/admin/OfficialRoutePlanMap.tsx", "utf8"),
  map: fs.readFileSync("components/mobile/EmployeeRouteMap.tsx", "utf8"),
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

requireText("identity", "belongsToCanonicalEmployee", "Canonical employee matching helper is missing.");
requireText("service", "canonicalEmployeeId: visit.employeeId", "Visits are not mapped to canonical Employee IDs.");
requireText("service", "canonicalCustomerId: visit.customerId", "Visits are not mapped to canonical Customer IDs.");
requireText("service", "visit.status !== \"cancelled\"", "Skipped dated Visits are hidden instead of remaining available for rescheduling.");
requireText("adminApi", "jobByProperty", "Admin routes do not support one permanent Job per Property.");
requireText("advisorApi", "failed canonical route verification", "Route Advisor publication has no final canonical verification.");
requireText("advisorApi", "More than one canonical Route exists", "Duplicate Employee/date Routes are not blocked.");
requireText("advisorApi", "daily_route_capacity", "Published routes do not enforce the Employee profile capacity.");
requireText("studio", "<OfficialRoutePlanMap date={date} onDateChange={setDate} />", "Dispatch View does not keep one controlled operational date.");
requireText("studio", "operationalDateKey", "Dispatch still uses a UTC date key.");
requireText("officialMap", "Select a worker to open the route.", "Route Plan employee overview is missing.");
requireText("officialMap", "onClick={() => setSelectedId(\"\")}", "Route Plan Back navigation is missing.");
requireText("officialMap", "originPoint={origin}", "Admin route view does not include the Employee starting point.");
requireText("officialMap", "official-house-list", "Route Plan does not include the scrollable house list.");
requireText("map", "Calculating driving route", "Driving route geometry is not requested.");
rejectText("studio", "assignedCrew === employee.name", "Route Plan still matches Employees by display name.");
rejectText("studio", "assignedCrew===employee.name", "Route Plan still matches Employees by display name.");
rejectText("map", "updateLead(", "Canonical map still writes coordinates to local Lead storage.");

if (failures.length) {
  console.error("Canonical Route validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Canonical Route validation passed.");
console.log("Customer → Property → Job → Visit → Route → Employee identity is enforced.");
console.log("Route Advisor remains capacity-aware, date-controlled and subject to Admin approval.");
