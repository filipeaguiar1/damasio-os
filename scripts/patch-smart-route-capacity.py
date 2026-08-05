from pathlib import Path
import json


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    start_index = text.index(start)
    end_index = text.index(end, start_index)
    return text[:start_index] + replacement.rstrip() + "\n\n" + text[end_index:]


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} did not match the current branch")
    return text.replace(old, new)


smart_path = Path("app/api/mobile/employee/smart-route/route.ts")
smart = smart_path.read_text()

road_matrix = r'''const OSRM_TABLE_BATCH_SIZE = 45;

function indexBatches(count: number) {
  const batches: number[][] = [];
  for (let start = 0; start < count; start += OSRM_TABLE_BATCH_SIZE) {
    batches.push(Array.from(
      { length: Math.min(OSRM_TABLE_BATCH_SIZE, count - start) },
      (_, offset) => start + offset,
    ));
  }
  return batches;
}

function localMatrixIndex(
  indexes: Map<number, number>,
  globalIndex: number,
) {
  const local = indexes.get(globalIndex);
  if (local === undefined) {
    throw new Error("Road optimizer matrix indexing failed.");
  }
  return local;
}

async function roadMatrix(origin: Origin, stops: Point[]) {
  const points = [origin, ...stops];
  const size = points.length;
  const distances = Array.from(
    { length: size },
    () => Array<number | null>(size).fill(null),
  );
  const durations = Array.from(
    { length: size },
    () => Array<number | null>(size).fill(null),
  );
  const batches = indexBatches(size);

  // Provider requests stay bounded, but the application does not impose a
  // separate Smart Route house limit. The Admin's Employee capacity is the
  // business limit for the route.
  for (const sourceBatch of batches) {
    for (const destinationBatch of batches) {
      const combined = [...new Set([...sourceBatch, ...destinationBatch])];
      const indexes = new Map(
        combined.map((globalIndex, local) => [globalIndex, local]),
      );
      const encoded = combined
        .map(index => `${points[index].longitude},${points[index].latitude}`)
        .join(";");
      const sources = sourceBatch
        .map(index => localMatrixIndex(indexes, index))
        .join(";");
      const destinations = destinationBatch
        .map(index => localMatrixIndex(indexes, index))
        .join(";");
      const response = await fetch(
        `https://router.project-osrm.org/table/v1/driving/${encoded}`
          + `?annotations=distance,duration&sources=${sources}`
          + `&destinations=${destinations}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error(`Road optimizer returned ${response.status}.`);
      }

      const result = await response.json() as {
        code?: string;
        distances?: Array<Array<number | null>>;
        durations?: Array<Array<number | null>>;
      };

      if (
        result.code !== "Ok"
        || !result.distances
        || !result.durations
        || result.distances.length !== sourceBatch.length
        || result.durations.length !== sourceBatch.length
      ) {
        throw new Error("Road distances could not be calculated.");
      }

      sourceBatch.forEach((sourceIndex, sourceOffset) => {
        const distanceRow = result.distances?.[sourceOffset];
        const durationRow = result.durations?.[sourceOffset];
        if (
          distanceRow?.length !== destinationBatch.length
          || durationRow?.length !== destinationBatch.length
        ) {
          throw new Error("Road optimizer returned an incomplete matrix.");
        }
        destinationBatch.forEach((destinationIndex, destinationOffset) => {
          distances[sourceIndex][destinationIndex]
            = distanceRow[destinationOffset] ?? null;
          durations[sourceIndex][destinationIndex]
            = durationRow[destinationOffset] ?? null;
        });
      });
    }
  }

  return { distances, durations };
}'''

scalable_order = r'''function edgeCost(
  matrix: Array<Array<number | null>>,
  from: number,
  to: number,
) {
  const value = matrix[from]?.[to];
  return Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;
}

function nearestRoadOrder(
  count: number,
  matrix: Array<Array<number | null>>,
  forcedFirst: number | null,
) {
  const remaining = new Set(
    Array.from({ length: count }, (_, index) => index + 1),
  );
  const order: number[] = [];
  let current = 0;

  if (forcedFirst !== null) {
    if (!remaining.has(forcedFirst)) {
      throw new Error("The requested Smart Route alternative is invalid.");
    }
    order.push(forcedFirst);
    remaining.delete(forcedFirst);
    current = forcedFirst;
  }

  while (remaining.size) {
    let next = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const cost = edgeCost(matrix, current, candidate);
      if (
        cost < best
        || (cost === best && (next < 0 || candidate < next))
      ) {
        best = cost;
        next = candidate;
      }
    }
    if (next < 0 || !Number.isFinite(best)) {
      throw new Error(
        "A complete driving route could not be calculated for these houses.",
      );
    }
    order.push(next);
    remaining.delete(next);
    current = next;
  }

  return order;
}

function adjacentSwapDelta(
  order: number[],
  index: number,
  matrix: Array<Array<number | null>>,
) {
  const previous = index === 0 ? 0 : order[index - 1];
  const left = order[index];
  const right = order[index + 1];
  const next = order[index + 2] ?? null;
  const before = edgeCost(matrix, previous, left)
    + edgeCost(matrix, left, right)
    + (next === null ? 0 : edgeCost(matrix, right, next));
  const after = edgeCost(matrix, previous, right)
    + edgeCost(matrix, right, left)
    + (next === null ? 0 : edgeCost(matrix, left, next));

  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return Number.POSITIVE_INFINITY;
  }
  return after - before;
}

function improveRoadOrder(
  initial: number[],
  matrix: Array<Array<number | null>>,
  lockFirst: boolean,
) {
  const order = initial.slice();
  const firstPair = lockFirst ? 1 : 0;

  // Adjacent improvements keep optimization polynomial as route capacity grows.
  for (let pass = 0; pass < order.length; pass += 1) {
    let bestIndex = -1;
    let bestDelta = -0.001;

    for (let index = firstPair; index < order.length - 1; index += 1) {
      const delta = adjacentSwapDelta(order, index, matrix);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) break;
    [order[bestIndex], order[bestIndex + 1]]
      = [order[bestIndex + 1], order[bestIndex]];
  }

  return order;
}

function scalableRoadOrder(
  count: number,
  matrix: Array<Array<number | null>>,
  alternative: number,
) {
  if (count < 1) return [];

  const starts = Array.from({ length: count }, (_, index) => index + 1)
    .sort((left, right) => {
      const difference = edgeCost(matrix, 0, left)
        - edgeCost(matrix, 0, right);
      return difference || left - right;
    });
  const forcedFirst = alternative > 0
    ? starts[alternative % starts.length]
    : null;
  const initial = nearestRoadOrder(count, matrix, forcedFirst);
  return improveRoadOrder(initial, matrix, forcedFirst !== null);
}'''

smart = replace_between(
    smart,
    "async function roadMatrix(origin: Origin, stops: Point[]) {",
    "function pathCost(",
    road_matrix,
)
smart = replace_between(
    smart,
    "function exactRoadOrder(",
    "function migrationMissing(",
    scalable_order,
)
smart = smart.replace("exactRoadOrder(", "scalableRoadOrder(")
if "supports up to 18 houses" in smart or "1 << count" in smart:
    raise SystemExit("The exponential Smart Route implementation was not removed")
smart_path.write_text(smart)

api_path = Path("app/api/admin/users/route.ts")
api = api_path.read_text()
api = replace_required(
    api,
    "dailyRouteCapacity: z.number().int().min(1).max(60).default(16)",
    "dailyRouteCapacity: z.number().int().min(1).default(16)",
    "Employee API capacity ceiling",
)
api_path.write_text(api)

admin_path = Path("app/admin/employees/page.tsx")
admin = admin_path.read_text()
admin = replace_required(
    admin,
    "Math.max(1, Math.min(60, Math.trunc(Number(form.dailyRouteCapacity || 0))))",
    "Math.max(1, Math.trunc(Number(form.dailyRouteCapacity || 0)))",
    "Admin web capacity clamp",
)
admin = replace_required(
    admin,
    ' min="1" max="60" step="1"',
    ' min="1" step="1"',
    "Admin web capacity input",
)
admin_path.write_text(admin)

mobile_path = Path("app/mobile/admin/employees/page.tsx")
mobile = mobile_path.read_text()
mobile = replace_required(
    mobile,
    "Math.max(1, Math.min(60, Math.trunc(Number(nextForm.dailyRouteCapacity || 0))))",
    "Math.max(1, Math.trunc(Number(nextForm.dailyRouteCapacity || 0)))",
    "Admin mobile capacity clamp",
)
mobile = replace_required(
    mobile,
    ' min="1" max="60"',
    ' min="1"',
    "Admin mobile capacity input",
)
mobile_path.write_text(mobile)

migration = Path(
    "supabase/migrations/202608050200_remove_employee_capacity_ceiling.sql"
)
migration.write_text(r'''begin;

-- The company Admin is the only source of the Employee daily house limit.
-- Smart Route and route publication must not impose a separate fixed ceiling.

alter table if exists public.profiles
  drop constraint if exists profiles_daily_route_capacity_check;
alter table if exists public.employees
  drop constraint if exists employees_daily_route_capacity_check;

alter table if exists public.profiles
  add constraint profiles_daily_route_capacity_check
  check (daily_route_capacity >= 1);
alter table if exists public.employees
  add constraint employees_daily_route_capacity_check
  check (daily_route_capacity >= 1);

update public.profiles
set daily_route_capacity = greatest(1, coalesce(daily_route_capacity, 16));
update public.employees
set daily_route_capacity = greatest(1, coalesce(daily_route_capacity, 16));

create or replace function public.sync_employee_route_capacity_from_profile()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_capacity integer;
begin
  if new.profile_id is null then return new; end if;
  select p.daily_route_capacity into v_capacity
  from public.profiles p
  where p.id = new.profile_id;
  if v_capacity is not null then
    new.daily_route_capacity := greatest(1, v_capacity);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_sync_route_capacity_from_profile
  on public.employees;
create trigger employees_sync_route_capacity_from_profile
before insert or update of profile_id, daily_route_capacity
on public.employees
for each row
execute function public.sync_employee_route_capacity_from_profile();

create or replace function public.sync_profile_route_capacity_to_employee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.employees
  set daily_route_capacity = greatest(1, new.daily_route_capacity)
  where profile_id = new.id
    and daily_route_capacity
      is distinct from greatest(1, new.daily_route_capacity);
  return new;
end;
$$;

drop trigger if exists profiles_sync_route_capacity_to_employee
  on public.profiles;
create trigger profiles_sync_route_capacity_to_employee
after insert or update of daily_route_capacity
on public.profiles
for each row
execute function public.sync_profile_route_capacity_to_employee();

notify pgrst, 'reload schema';

commit;
''')

test_path = Path("scripts/validate-smart-route-capacity.mjs")
test_path.write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const smartRoute = read("app/api/mobile/employee/smart-route/route.ts");
const employeeApi = read("app/api/admin/users/route.ts");
const adminWeb = read("app/admin/employees/page.tsx");
const adminMobile = read("app/mobile/admin/employees/page.tsx");
const capacityMigration = read(
  "supabase/migrations/202608050200_remove_employee_capacity_ceiling.sql",
);

assert.match(
  smartRoute,
  /function scalableRoadOrder\(/,
  "Smart Route must use the scalable optimizer.",
);
assert.match(
  smartRoute,
  /OSRM_TABLE_BATCH_SIZE/,
  "Large routes must build the road matrix in provider-safe batches.",
);
assert.match(
  smartRoute,
  /sources=\$\{sources\}/,
  "Matrix batching must specify source subsets.",
);
assert.match(
  smartRoute,
  /destinations=\$\{destinations\}/,
  "Matrix batching must specify destination subsets.",
);
assert.doesNotMatch(
  smartRoute,
  /supports up to \d+ houses/i,
  "Smart Route cannot impose a fixed house count.",
);
assert.doesNotMatch(
  smartRoute,
  /1\s*<<\s*count|new Float64Array\(size \* width\)/,
  "Exponential exact-route allocation is forbidden.",
);
assert.doesNotMatch(
  employeeApi,
  /dailyRouteCapacity:[^\n]+\.max\(/,
  "Employee API capacity cannot have a fixed maximum.",
);
assert.doesNotMatch(
  adminWeb,
  /Math\.min\(60|max="60"/,
  "Admin web cannot clamp capacity to 60.",
);
assert.doesNotMatch(
  adminMobile,
  /Math\.min\(60|max="60"/,
  "Admin mobile cannot clamp capacity to 60.",
);
assert.match(
  capacityMigration,
  /check \(daily_route_capacity >= 1\)/,
  "Database capacity must remain positive.",
);
assert.doesNotMatch(
  capacityMigration,
  /least\(60/,
  "Database synchronization cannot restore the old ceiling.",
);

console.log("PASS Smart Route scalable capacity contract");
''')

package_path = Path("package.json")
package = json.loads(package_path.read_text())
scripts = package["scripts"]
scripts["test:smart-route-capacity"] = (
    "node scripts/validate-smart-route-capacity.mjs"
)
scripts["build"] = (
    "pnpm test:route-writers && pnpm test:map-sync "
    "&& pnpm test:smart-route-capacity && pnpm typecheck && next build"
)
scripts["check"] = (
    "pnpm test:route-writers && pnpm test:map-sync "
    "&& pnpm test:smart-route-capacity && pnpm typecheck"
)
package_path.write_text(json.dumps(package, indent=2) + "\n")

checkpoint = Path(
    "docs/checkpoints/2026-08-05-smart-route-canonical-stable.md"
)
checkpoint.parent.mkdir(parents=True, exist_ok=True)
checkpoint.write_text(r'''# Smart Route canonical stability checkpoint

Date: 2026-08-05 (America/Toronto)
Branch: `feature/25-30-homes-simulator-v1`
PR: `#40`

## Verified at this checkpoint

- Smart Route order persisted after closing and reopening the mobile application.
- Admin mobile and Employee mobile displayed the same route order.
- The canonical database writer, route version, origin and ordered Visit IDs
  were protected and re-read before success.
- Legacy route writers were prevented from overwriting an active canonical
  Smart Route.
- The fixed 18-house optimizer ceiling and fixed 60-house Employee capacity
  ceiling were removed.
- The company Admin's `daily_route_capacity` remains the only daily house limit.

## Still requiring explicit regression testing

- Admin web and Employee web display the same canonical snapshot.
- Smart Route optimization with 25, 30, 60 and 100 houses.
- Concurrent routes for multiple Employees.
- Start, timer, Done, photos and reopen flows under concurrent use.

This checkpoint records that Smart Route was apparently functioning correctly
on the tested mobile Admin and Employee flows on this date. It is a regression
reference, not a claim that every scale and concurrency scenario has already
been certified.
''')
