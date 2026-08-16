import fs from "node:fs";

const routePath = new URL("../app/api/public/quote-referral/route.ts", import.meta.url);
const source = fs.readFileSync(routePath, "utf8");

const forbiddenCanonicalWrites = [
  '.from("customers")',
  ".from('customers')",
  '.from("properties")',
  ".from('properties')",
];

for (const marker of forbiddenCanonicalWrites) {
  if (source.includes(marker)) {
    throw new Error(`Public quote intake contract violated: canonical data access found (${marker}).`);
  }
}

if (!source.includes("customer_id: null") || !source.includes("property_id: null")) {
  throw new Error("Public quote intake contract violated: lead must not link canonical Customer/Property IDs.");
}

if (/leadId|customerId|propertyId/.test(source)) {
  throw new Error("Public quote intake contract violated: internal IDs must not be returned or handled by the public endpoint.");
}

if (!source.includes('.from("lead_center")')) {
  throw new Error("Public quote intake contract violated: lead_center intake is missing.");
}

console.log("Public quote intake contract: PASS");
