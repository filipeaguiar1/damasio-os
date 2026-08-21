import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

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

for (const path of [
  "playwright.operator.config.ts",
  "tests/browser-operator/safety.ts",
  "tests/browser-operator/operator-smoke.spec.ts",
  ".github/workflows/browser-operator-qa.yml",
]) {
  assert.ok(existsSync(path), `Browser Operator QA implementation is missing: ${path}`);
}

const safety = readFileSync("tests/browser-operator/safety.ts", "utf8");
assert.match(safety, /QA_ALLOW_MUTATIONS/, "Browser runner must require explicit mutation permission.");
assert.match(safety, /QA_NAMESPACE/, "Browser runner must require a QA namespace.");
assert.match(safety, /sk_live_/, "Browser runner must reject live Stripe keys.");

const config = readFileSync("playwright.operator.config.ts", "utf8");
assert.match(config, /trace: "retain-on-failure"/, "Browser runner must retain failed traces.");
assert.match(config, /video: "retain-on-failure"/, "Browser runner must retain failed video.");
assert.match(config, /screenshot: "only-on-failure"/, "Browser runner must capture failure screenshots.");

console.log("PASS Browser Operator QA architecture/safety lock");
