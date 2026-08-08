import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const advisor = readFileSync("components/admin/RouteAdvisorPanel.tsx", "utf8");
const employees = readFileSync("app/admin/employees/page.tsx", "utf8");

assert.match(advisor, /item\.canonicalCrewId === employee\.crewId/, "Route Advisor must filter Jobs by the selected Employee crew.");
assert.match(advisor, /function selectAllVisible\(/, "Route Advisor must provide Select all.");
assert.match(advisor, /setSelectedJobIds\(\[\]\);\n    setRecommendations/, "Changing Employee must clear stale selections.");
assert.match(employees, /routeResult\.board\?\.assignedJobs/, "Employee contracts must use the canonical scheduling board.");
assert.match(employees, /job\.crewId.*crewId/, "Employee contract list must derive from canonical crew assignment.");
assert.match(employees, /employee-contract-toggle/, "Employee profiles must include a collapsible contracts control.");
console.log("PASS employee contract routing contract");
