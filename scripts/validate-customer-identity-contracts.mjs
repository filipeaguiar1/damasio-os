import fs from "node:fs";

const routes = [
  "app/api/customer/property/route.ts",
  "app/api/customer/property/photo/route.ts",
  "app/api/customer/payment-preferences/route.ts",
];

for (const route of routes) {
  const source = fs.readFileSync(new URL(`../${route}`, import.meta.url), "utf8");
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
  new URL("../app/api/customer/property/photo/route.ts", import.meta.url),
  "utf8",
);
if (/\.update\(\s*\{\s*(customer_id|profile_id)\s*:/.test(propertyPhoto)) {
  throw new Error("Property photo upload must never relink canonical Customer/Profile ownership.");
}
if (!propertyPhoto.includes("EXTENSION_BY_MIME") || !propertyPhoto.includes("8 * 1024 * 1024")) {
  throw new Error("Property photo upload MIME/size guard is missing.");
}

const paymentSearch = fs.readFileSync(
  new URL("../components/payments/CustomerSelectSearchEnhancer.tsx", import.meta.url),
  "utf8",
);
if (paymentSearch.includes('dispatchEvent(new Event("change"') || paymentSearch.includes("dispatchEvent(new Event('change'")) {
  throw new Error("Customer search must not auto-dispatch a financial Customer selection change.");
}

console.log("Customer identity and financial selection contracts: PASS");
