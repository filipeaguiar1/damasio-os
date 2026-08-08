import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components", "lib"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Every direct canonical writer must be deliberate and independently verified.
// Most files below perform audited lifecycle maintenance. Route Advisor performs
// verified publication materialization, while the Employee resolver may repair a
// legacy publication only after proving the Route belongs to the authenticated
// profile and date. The compatibility projector is server-only and may mirror
// route_stops positions into visits.route_order when the deployed projection RPC
// is unavailable; it never derives or writes canonical route_stops order.
const allowed = new Set([
  "app/api/mobile/employee/smart-route/route.ts",
  "app/api/admin/customers/route.ts",
  "app/api/admin/operational-simulator/route.ts",
  "app/api/mobile/employee/route/route.ts",
  "app/api/admin/route-advisor/route.ts",
  "app/api/employee/canonical-route/route.ts",
  "lib/routes/projectCanonicalVisitOrderCompatibility.ts",
]);

const mutationPatterns = [
  /from\(["']route_stops["']\)[\s\S]{0,240}\.(insert|upsert|update|delete)\s*\(/m,
  /from\(["']visits["']\)[\s\S]{0,240}\.update\s*\([\s\S]{0,240}route_order/m,
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return extensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

const violations = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const normalized = file.split(path.sep).join("/");
    if (allowed.has(normalized)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of mutationPatterns) {
      if (pattern.test(source)) {
        violations.push(normalized);
        break;
      }
    }
  }
}

if (violations.length) {
  console.error("Direct canonical-route writes are forbidden outside approved writers:");
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

console.log("PASS canonical route writer boundary");
