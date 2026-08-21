import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const doc = readFileSync("docs/QA_BROWSER_OPERATOR.md", "utf8");
for (const required of ["QA_ALLOW_MUTATIONS=1","QA_NAMESPACE","Never use live Stripe credentials","route_stops.position -> visits.route_order","Stale Sunday recurrence","Published-week replacement","Calendar duplication","Calendar layering","Idle auth recovery","Route reload recovery","Geographic clustering","Cleanup proof","Admin / company operator","Employee","Customer","Master"]) {
  assert.ok(doc.includes(required), `Browser Operator QA contract is missing: ${required}`);
}
assert.match(doc, /fail closed/i);
assert.match(doc, /cleanup is mandatory/i);
assert.match(doc, /traces, screenshots and video/i);
for (const path of [
  "playwright.operator.config.mjs",
  "tests/browser-operator/safety.ts",
  "tests/browser-operator/fixtures.ts",
  "tests/browser-operator/fixture-cleanup.ts",
  "tests/browser-operator/fixture-create.ts",
  "tests/browser-operator/fixture-db.ts",
  "tests/browser-operator/fixture-env.ts",
  "tests/browser-operator/fixture-route.ts",
  "tests/browser-operator/fixture-types.ts",
  "tests/browser-operator/operator-smoke.spec.ts",
  "tests/browser-operator/admin-core-navigation.spec.ts",
  "tests/browser-operator/admin-mutable-journey.spec.ts",
  "tests/browser-operator/employee-mobile-journey.spec.ts",
  "tests/browser-operator/customer-master-smoke.spec.ts",
  ".github/workflows/browser-operator-qa.yml",
]) {
  assert.ok(existsSync(path), `Browser Operator QA implementation is missing: ${path}`);
}
const safety = readFileSync("tests/browser-operator/safety.ts", "utf8");
assert.match(safety, /QA_ALLOW_MUTATIONS/);
assert.match(safety, /QA_NAMESPACE/);
assert.match(safety, /sk_live_/);
const fixtures = [
  "tests/browser-operator/fixtures.ts",
  "tests/browser-operator/fixture-cleanup.ts",
  "tests/browser-operator/fixture-create.ts",
  "tests/browser-operator/fixture-db.ts",
  "tests/browser-operator/fixture-env.ts",
  "tests/browser-operator/fixture-route.ts",
  "tests/browser-operator/fixture-types.ts",
].map(path => readFileSync(path, "utf8")).join("\n");
assert.match(fixtures, /createMutableOperatorFixture/);
assert.match(fixtures, /cleanupMutableOperatorFixture/);
assert.match(fixtures, /assertNoMutableResidue/);
assert.match(fixtures, /route_stops/);
assert.match(fixtures, /work-photos/);
const adminJourney = readFileSync("tests/browser-operator/admin-mutable-journey.spec.ts", "utf8");
for (const required of [
  "stale Sunday recurrence",
  "published-week replacement",
  "remove_today",
  "cancel_scheduled_visit",
  "assertCanonicalRouteOrder",
  "Burlington",
  "Hamilton",
]) assert.ok(adminJourney.includes(required), `Admin mutable journey is missing: ${required}`);
const employeeJourney = readFileSync("tests/browser-operator/employee-mobile-journey.spec.ts", "utf8");
for (const required of ["mobile/employee", "action: \"start\"", "action: \"done\"", "portal-actions", "attachQaVisitPhoto"]) {
  assert.ok(employeeJourney.includes(required), `Employee mobile journey is missing: ${required}`);
}
const customerMaster = readFileSync("tests/browser-operator/customer-master-smoke.spec.ts", "utf8");
for (const required of ["mobile/customer", "QA_MASTER_EMAIL", "master/payouts"]) {
  assert.ok(customerMaster.includes(required), `Customer/Master smoke is missing: ${required}`);
}
const config = readFileSync("playwright.operator.config.mjs", "utf8");
assert.match(config, /trace: "retain-on-failure"/);
assert.match(config, /video: "retain-on-failure"/);
assert.match(config, /screenshot: "only-on-failure"/);
assert.match(config, /employee-mobile/);
console.log("PASS Browser Operator QA architecture/safety lock");
