import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const doc = readFileSync("docs/QA_BROWSER_OPERATOR.md", "utf8");
for (const required of ["QA_ALLOW_MUTATIONS=1","QA_NAMESPACE","Never use live Stripe credentials","route_stops.position -> visits.route_order","Stale Sunday recurrence","Published-week replacement","Calendar duplication","Calendar layering","Idle auth recovery","Route reload recovery","Geographic clustering","Cleanup proof","Admin / company operator","Employee","Customer","Master"]) {
  assert.ok(doc.includes(required), `Browser Operator QA contract is missing: ${required}`);
}
assert.match(doc, /fail closed/i);
assert.match(doc, /cleanup is mandatory/i);
assert.match(doc, /traces, screenshots and video/i);
for (const path of ["playwright.operator.config.mjs","tests/browser-operator/safety.ts","tests/browser-operator/operator-smoke.spec.ts",".github/workflows/browser-operator-qa.yml"]) {
  assert.ok(existsSync(path), `Browser Operator QA implementation is missing: ${path}`);
}
const safety = readFileSync("tests/browser-operator/safety.ts", "utf8");
assert.match(safety, /QA_ALLOW_MUTATIONS/);
assert.match(safety, /QA_NAMESPACE/);
assert.match(safety, /sk_live_/);
const config = readFileSync("playwright.operator.config.mjs", "utf8");
assert.match(config, /trace: "retain-on-failure"/);
assert.match(config, /video: "retain-on-failure"/);
assert.match(config, /screenshot: "only-on-failure"/);
console.log("PASS Browser Operator QA architecture/safety lock");
