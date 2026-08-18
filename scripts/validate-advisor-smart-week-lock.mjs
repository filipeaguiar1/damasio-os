import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const planner = read("components/admin/AdvancedRoutePlannerV7.tsx");
const layout = read("app/layout.tsx");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`async function ${name}()`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.length;
  assert.notEqual(end, -1, `Could not isolate ${name}.`);
  return source.slice(start, end);
}

assert.match(
  planner,
  /for\(const day of days\)\{while\(day\.capacity>day\.homes\.length&&remaining\.length\)/,
  "Advisor Smart Week must fill each earlier day to its configured capacity before opening the next day.",
);
assert.doesNotMatch(
  planner,
  /rebalanceGeographicDays|clusterCost/,
  "Cross-day mathematical rebalancing is forbidden: it previously split obvious geographic clusters and destabilized the week.",
);

const fitAndSave = functionBody(planner, "fitAndSaveNew", "moveHouse");
assert.match(fitAndSave, /mapHomes\(unplannedSelected\)/, "Fit & save must operate on selected new houses.");
assert.match(fitAndSave, /day\.capacity>day\.homes\.length/, "Fit & save must respect daily capacity.");
assert.match(fitAndSave, /haversineKm\(/, "Fit & save must use geographic distance.");
assert.match(fitAndSave, /centroid\(/, "Fit & save must consider candidate-day geographic clustering.");
assert.match(fitAndSave, /optimize\(start,day\.homes\)/, "Fit & save must recalculate daily stop order.");
assert.match(fitAndSave, /await savePlan\(days,false,false\)/, "Fit & save must persist canonical membership immediately.");
assert.doesNotMatch(fitAndSave, /denseGeographicPlan\(/, "Fit & save must not rebuild the entire published week for incremental additions.");
assert.doesNotMatch(layout, /AdvisorCanonicalPersistenceEnhancer/, "The legacy Advisor persistence enhancer must never be mounted over V7.");

function expectedPackedCounts(total, capacities) {
  let remaining = total;
  return capacities.map(capacity => {
    const used = Math.min(Math.max(0, capacity), remaining);
    remaining -= used;
    return used;
  });
}

assert.deepEqual(expectedPackedCounts(27, [16, 16, 16, 16, 16, 0, 0]), [16, 11, 0, 0, 0, 0, 0]);
assert.deepEqual(expectedPackedCounts(32, [16, 16, 16, 16, 16, 0, 0]), [16, 16, 0, 0, 0, 0, 0]);
assert.deepEqual(expectedPackedCounts(20, [16, 16, 16, 16, 16, 0, 0]), [16, 4, 0, 0, 0, 0, 0]);

console.log("PASS Advisor deterministic Smart Week regression lock");
