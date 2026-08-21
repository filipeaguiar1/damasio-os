import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const doc = readFileSync("docs/QA_BROWSER_OPERATOR.md", "utf8");

for (const required of [
  "QA_ALLOW_MUTATIONS=1",
  "QA_NAMESPACE",
  "Never use live Stripe credentials",
  "route_stops.position -> visits.route_order",
  "Stale Sunday recurrence",
  "Published-week replacement",
  "Calendar duplication",
  "Calendar layering",
  "Idle auth recovery",
  "Route reload recovery",
  "Geographic clustering",
  "Cleanup proof",
  "Admin / company operator",
  "Employee",
  "Customer",
  "Master",
]) {
  assert.ok(doc.includes(required), `Browser Operator QA contract is missing: ${required}`);
}

assert.match(doc, /fail closed/i, "Browser QA must fail closed outside the approved QA environment.");
assert.match(doc, /cleanup is mandatory/i, "Browser QA must make cleanup mandatory.");
assert.match(doc, /traces, screenshots and video/i, "Browser QA must retain visual debugging evidence.");

console.log("PASS Browser Operator QA architecture/safety lock");
