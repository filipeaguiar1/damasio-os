import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8");

if (/from\(["']invoices["']\)[\s\S]{0,180}select\(["'][^"']*company_id/.test(route)) {
  throw new Error("Stripe invoice checkout must not select invoices.company_id; the canonical invoice tenant column is organization_id.");
}

if (/\binsertPayload\s*=\s*\{[\s\S]{0,350}\bcompany_id\s*:/.test(route)) {
  throw new Error("Manual Stripe invoice creation must not write invoices.company_id; use organization_id.");
}

if (!route.includes('from("invoices")') || !route.includes("organization_id")) {
  throw new Error("Stripe invoice checkout must use the canonical invoices.organization_id tenant key.");
}

console.log("Stripe invoice schema contract: PASS");
