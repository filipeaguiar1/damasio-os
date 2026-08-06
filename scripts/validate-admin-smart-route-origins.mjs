import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("components/admin/RouteAdvisorPanel.tsx", "utf8");

for (const label of [
  "Current location",
  "Last completed house",
  "Manual address",
  "Profile address",
]) {
  assert.match(panel, new RegExp(label), `Missing Smart Route origin option: ${label}`);
}

assert.match(panel, /AddressAutocomplete/, "Manual address must use the shared autocomplete component.");
assert.match(panel, /navigator\.geolocation\.getCurrentPosition/, "Current location must use browser geolocation.");
assert.match(panel, /lastCompleted/, "Last completed house must come from the canonical route.");
assert.match(panel, /profileStartAddress/, "Profile address must come from the selected Employee profile.");
assert.match(panel, /manualOriginPoint/, "Autocomplete coordinates must be reused after selection.");
assert.match(panel, /label: origin\.label/, "The selected origin label must be published with the canonical Route.");
assert.doesNotMatch(
  panel,
  /setSmartRouteAddress\(canonicalAddress \|\| employee\.routeStartAddress/,
  "The manual field cannot be silently populated from another origin mode.",
);

console.log("PASS Admin Smart Route exposes four explicit canonical origin options with autocomplete");
