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

// Smart Week policy: Monday -> Sunday are all valid operating days. Capacity is a
// ceiling, never a target that justifies splitting a coherent geographic cluster.
assert.match(
  planner,
  /useState<number\[]>\(\[16,16,16,16,16,16,16\]\)/,
  "Advisor Smart Week must keep all seven operating days available by default.",
);
assert.match(
  planner,
  /const nextCaps=DAY_LABELS\.map\(\(_,index\)=>Math\.max\(employee\.dailyCapacity,counts\[index\]\)\)/,
  "Employee daily capacity must apply Monday through Sunday unless Admin changes a day manually.",
);
assert.match(
  planner,
  /function localityKey\(/,
  "Smart Week must identify locality clusters before assigning houses to days.",
);
assert.match(
  planner,
  /function geographicClusters\(/,
  "Smart Week must group houses geographically before day allocation.",
);
assert.doesNotMatch(
  planner,
  /for\(const day of days\)\{while\(day\.capacity>day\.homes\.length&&remaining\.length\)/,
  "Smart Week must not greedily fill a day house-by-house across geographic clusters.",
);
assert.match(
  planner,
  /const matching=days\.find\(day=>day\.capacity>day\.homes\.length&&day\.homes\.some\(home=>localityKey\(home\)===cluster\.key\)\)/,
  "An existing locality cluster should stay on its day before opening another day.",
);
assert.match(
  planner,
  /const empty=days\.find\(day=>day\.capacity>day\.homes\.length&&day\.homes\.length===0\)/,
  "A different locality should prefer the next empty day instead of filling spare capacity in another locality.",
);
assert.match(
  planner,
  /for\(const day of days\)day\.homes=await optimize\(start,day\.homes\)/,
  "Each daily cluster must still be ordered by the route optimizer.",
);

// Fit & save remains incremental. It may add selected due work without rebuilding
// an already-reviewed week; the explicit Rebuild Smart Week action owns cross-day clustering.
const fitAndSave = functionBody(planner, "fitAndSaveNew", "moveHouse");
assert.match(
  fitAndSave,
  /mapHomes\(unplannedSelected\)/,
  "Fit & save must operate on the selected new houses.",
);
assert.match(
  fitAndSave,
  /day\.capacity>day\.homes\.length/,
  "Fit & save must never place a house into a full day.",
);
assert.match(
  fitAndSave,
  /haversineKm\(/,
  "Fit & save must use geographic distance when choosing a day.",
);
assert.match(
  fitAndSave,
  /centroid\(/,
  "Fit & save must consider the geographic cluster of the candidate day.",
);
assert.match(
  fitAndSave,
  /optimize\(start,day\.homes\)/,
  "Fit & save must recalculate stop order after adding houses.",
);
assert.match(
  fitAndSave,
  /await savePlan\(days,false,false\)/,
  "Fit & save must persist canonical house/day membership immediately.",
);
assert.doesNotMatch(
  fitAndSave,
  /denseGeographicPlan\(/,
  "Fit & save must not rebuild the entire published week when only new houses are being added.",
);
assert.doesNotMatch(
  layout,
  /AdvisorCanonicalPersistenceEnhancer/,
  "The legacy Advisor persistence enhancer must never be mounted over AdvancedRoutePlannerV7.",
);

// Policy examples. Distinct clusters deliberately leave spare capacity behind.
function expectedClusterCounts(clusterSizes, capacities) {
  const used = capacities.map(() => 0);
  let dayIndex = 0;
  for (const size of clusterSizes) {
    let remaining = size;
    while (remaining > 0) {
      while (dayIndex < capacities.length && used[dayIndex] >= capacities[dayIndex]) dayIndex += 1;
      assert.ok(dayIndex < capacities.length, "Cluster plan exceeded weekly capacity.");
      const available = capacities[dayIndex] - used[dayIndex];
      const take = Math.min(available, remaining);
      used[dayIndex] += take;
      remaining -= take;
      // A finished locality never shares its leftover daily room with the next locality.
      if (remaining === 0) dayIndex += 1;
    }
  }
  return used;
}

assert.deepEqual(
  expectedClusterCounts([16, 8], [18, 18, 18, 18, 18, 18, 18]),
  [16, 8, 0, 0, 0, 0, 0],
  "16 Hamilton + 8 Burlington at capacity 18 must remain separate days.",
);
assert.deepEqual(
  expectedClusterCounts([25, 8], [18, 18, 18, 18, 18, 18, 18]),
  [18, 7, 8, 0, 0, 0, 0],
  "An oversized locality may span days, but the next locality starts on a new day.",
);
assert.deepEqual(
  expectedClusterCounts([16, 16, 16, 16, 16, 10], [16, 16, 16, 16, 16, 16, 16]),
  [16, 16, 16, 16, 16, 10, 0],
  "Saturday must be available when Monday-Friday capacity is naturally exhausted.",
);
assert.deepEqual(
  expectedClusterCounts([16, 16, 16, 16, 16, 16, 4], [16, 16, 16, 16, 16, 16, 16]),
  [16, 16, 16, 16, 16, 16, 4],
  "Sunday must be available last in the Monday-to-Sunday priority sequence.",
);

console.log("PASS Advisor geographic Smart Week regression lock");
