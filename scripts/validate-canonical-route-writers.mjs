import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components", "lib"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Every direct canonical writer must be deliberate and independently verified.
// Most files below perform audited lifecycle maintenance. Route Advisor performs
// verified publication materialization, while the Employee resolver may repair a
// legacy publication only after proving the Route belongs to the authenticated
// profile and date. No UI component or generic repository is allowed to write.
const allowed = new Set([
  "app/api/mobile/employee/smart-route/route.ts",
  "app/api/admin/customers/route.ts",
  "app/api/admin/operational-simulator/route.ts",
  "app/api/mobile/employee/route/route.ts",
  "app/api/admin/route-advisor/route.ts",
  "app/api/employee/canonical-route/route.ts",
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

// Temporary CI-only probe for the route that regressed from v3 to v2 in E2E #520.
// It runs before the operational simulator can clean the failed fixture.
const diagnosticRouteId = "a741f098-4c22-45ba-bdda-35fe1681cfca";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const query = async (table, params) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(`${table} diagnostic failed: ${response.status} ${await response.text()}`);
    return response.json();
  };
  console.log("DIAG_ROUTE_ORDER_STATE", JSON.stringify(await query("route_order_state", `route_id=eq.${diagnosticRouteId}&select=route_id,version,last_source,updated_at`)));
  console.log("DIAG_SMART_ROUTE_STATE", JSON.stringify(await query("employee_smart_route_state", `route_id=eq.${diagnosticRouteId}&select=route_id,route_version,active,applied_order,updated_at`)));
  console.log("DIAG_ROUTE_ORDER_AUDIT", JSON.stringify(await query("route_order_audit", `route_id=eq.${diagnosticRouteId}&select=route_id,route_version,source,next_order,created_at&order=created_at.desc&limit=10`)));
  console.log("DIAG_ROUTE_STOPS", JSON.stringify(await query("route_stops", `route_id=eq.${diagnosticRouteId}&select=visit_id,position,updated_at&order=position.asc`)));
  throw new Error("CANONICAL_ROUTE_DIAGNOSTIC_COMPLETE");
}
