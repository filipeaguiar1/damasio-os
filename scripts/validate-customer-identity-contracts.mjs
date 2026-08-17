import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const customerApiRoot = path.join(repoRoot, "app/api/customer");

function collectCustomerRoutes(directory) {
  const routes = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...collectCustomerRoutes(fullPath));
    else if (entry.isFile() && entry.name === "route.ts") routes.push(fullPath);
  }
  return routes;
}

const customerRoutes = collectCustomerRoutes(customerApiRoot);
if (customerRoutes.length === 0) {
  throw new Error("Customer identity contract could not find any API routes.");
}

for (const absoluteRoute of customerRoutes) {
  const route = path.relative(repoRoot, absoluteRoute).replaceAll("\\", "/");
  const source = fs.readFileSync(absoluteRoute, "utf8");
  if (!source.includes("requireCustomerPortalIdentity")) {
    throw new Error(`${route}: canonical Customer identity guard is missing.`);
  }
  if (source.includes('from("@supabase/supabase-js")') || source.includes("from('@supabase/supabase-js')")) {
    throw new Error(`${route}: direct Supabase client recreated outside the canonical Customer identity guard.`);
  }
  if (/\.ilike\(\s*["']email["']/.test(source) || /\.or\(\s*`profile_id\.eq\./.test(source)) {
    throw new Error(`${route}: email/profile fallback identity lookup is forbidden.`);
  }
}

const propertyPhoto = fs.readFileSync(
  path.join(customerApiRoot, "property/photo/route.ts"),
  "utf8",
);
if (/\.update\(\s*\{\s*(customer_id|profile_id)\s*:/.test(propertyPhoto)) {
  throw new Error("Property photo upload must never relink canonical Customer/Profile ownership.");
}
if (!propertyPhoto.includes("EXTENSION_BY_MIME") || !propertyPhoto.includes("8 * 1024 * 1024")) {
  throw new Error("Property photo upload MIME/size guard is missing.");
}

const paymentSearch = fs.readFileSync(
  path.join(repoRoot, "components/payments/CustomerSelectSearchEnhancer.tsx"),
  "utf8",
);
if (paymentSearch.includes('dispatchEvent(new Event("change"') || paymentSearch.includes("dispatchEvent(new Event('change'")) {
  throw new Error("Customer search must not auto-dispatch a financial Customer selection change.");
}

console.log(`Customer identity and financial selection contracts: PASS (${customerRoutes.length} Customer API routes)`);
