import fs from "node:fs";

const service = fs.readFileSync("lib/services/routeMapService.ts", "utf8");
const required = [
  "const smartRoutePreviewVersions = new Map<string, number>();",
  "smartRoutePreviewVersions.set(params.routeId, reviewedVersion);",
  "smartRoutePreviewVersions.get(params.routeId)",
  "expectedVersion: reviewedVersion",
  "smartRoutePreviewVersions.delete(params.routeId);",
  "Refresh the route before creating a Smart Route preview.",
  "Refresh the route and create the preview again before applying it.",
];

const missing = required.filter(value => !service.includes(value));
if (missing.length) {
  console.error("Smart Route preview-version validation failed:");
  for (const value of missing) console.error(`- missing: ${value}`);
  process.exit(1);
}

const previewLookup = service.indexOf("smartRoutePreviewVersions.get(params.routeId)");
const fallbackLookup = service.indexOf("params.expectedVersion", previewLookup);
if (previewLookup < 0 || fallbackLookup < 0 || previewLookup > fallbackLookup) {
  console.error("Apply must prefer the version captured with the preview.");
  process.exit(1);
}

console.log("Smart Route Apply is bound to the exact preview version.");
