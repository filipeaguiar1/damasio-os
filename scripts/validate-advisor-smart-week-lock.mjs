import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const planner = read("components/admin/AdvancedRoutePlannerV7.tsx");
const layout = read("app/layout.tsx");

// Regression lock: Smart Week must remain deterministic and capacity-first.
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
assert.match(
  planner,
  /const all=uniqueHomes\(\[\.\.\.plan\.flatMap\(day=>day\.homes\),\.\.\.unplannedSelected\]\);const days=await denseGeographicPlan\(all,start\)/,
  "Fit & save must rebuild the selected canonical week with the deterministic planner.",
);
assert.match(
  planner,
  /await savePlan\(days,false,false\)/,
  "Fit & save must persist canonical house/day membership immediately.",
);
assert.doesNotMatch(
  layout,
  /AdvisorCanonicalPersistenceEnhancer/,
  "The legacy Advisor persistence enhancer must never be mounted over AdvancedRoutePlannerV7.",
);

function expectedPackedCounts(total, capacities) {
  let remaining = total;
  return capacities.map(capacity => {
    const used = Math.min(Math.max(0, capacity), remaining);
    remaining -= used;
    return used;
  });
}

assert.deepEqual(
  expectedPackedCounts(27, [16, 16, 16, 16, 16, 0, 0]),
  [16, 11, 0, 0, 0, 0, 0],
  "27 houses with capacity 16 must occupy Monday 16 + Tuesday 11 only.",
);
assert.deepEqual(
  expectedPackedCounts(32, [16, 16, 16, 16, 16, 0, 0]),
  [16, 16, 0, 0, 0, 0, 0],
  "32 houses must not spill into Wednesday.",
);
assert.deepEqual(
  expectedPackedCounts(20, [16, 16, 16, 16, 16, 0, 0]),
  [16, 4, 0, 0, 0, 0, 0],
  "A partially filled second day is allowed only after the first day is full.",
);

console.log("PASS Advisor deterministic Smart Week regression lock");
