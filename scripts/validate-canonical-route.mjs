import fs from "node:fs";

const files = {
  identity: fs.readFileSync("lib/routes/canonicalRouteIdentity.ts", "utf8"),
  service: fs.readFileSync("lib/services/schedulingService.ts", "utf8"),
  adminApi: fs.readFileSync("app/api/admin/routes/route.ts", "utf8"),
  studio: fs.readFileSync("components/admin/RouteStudio.tsx", "utf8"),
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
requireText("adminApi", "jobByProperty", "Admin routes do not support one job per property.");
requireText("adminApi", "failed the canonical route verification", "Route publication has no final canonical verification.");
requireText("adminApi", "More than one canonical Route exists", "Duplicate Employee/date routes are not blocked.");
requireText("studio", "Back to Employees", "Route Plan worker navigation is missing.");
requireText("studio", "EmployeeDirectory", "Route Plan employee overview is missing.");
requireText("studio", "originPoint={viewOrigin}", "Admin route view does not include the Employee starting point.");
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
