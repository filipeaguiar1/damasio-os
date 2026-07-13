import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
type Coordinate = [number, number];

function distance(a: Coordinate, b: Coordinate) {
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestNeighbour(matrix: number[][]) {
  if (!matrix.length) return [];
  const remaining = new Set(matrix.map((_, index) => index));
  const order = [0];
  remaining.delete(0);
  while (remaining.size) {
    const current = order[order.length - 1];
    let next = -1;
    let best = Number.POSITIVE_INFINITY;
    remaining.forEach(candidate => {
      const cost = matrix[current][candidate];
      if (cost < best) { best = cost; next = candidate; }
    });
    order.push(next);
    remaining.delete(next);
  }
  return order;
}

function improve(order: number[], matrix: number[][]) {
  const result = [...order];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < result.length - 2; i++) for (let k = i + 1; k < result.length - 1; k++) {
      const before = matrix[result[i - 1]][result[i]] + matrix[result[k]][result[k + 1]];
      const after = matrix[result[i - 1]][result[k]] + matrix[result[i]][result[k + 1]];
      if (after + 1 < before) {
        result.splice(i, k - i + 1, ...result.slice(i, k + 1).reverse());
        changed = true;
      }
    }
  }
  return result;
}

// Finds the globally shortest open route while keeping point 0 fixed as departure.
function exactOpenRoute(matrix: number[][]) {
  const size = matrix.length;
  const states = 1 << size;
  const costs = Array.from({ length: states }, () => new Float64Array(size).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: states }, () => new Int16Array(size).fill(-1));
  costs[1][0] = 0;
  for (let mask = 1; mask < states; mask += 2) {
    for (let last = 0; last < size; last++) {
      const current = costs[mask][last];
      if (!Number.isFinite(current)) continue;
      for (let next = 1; next < size; next++) {
        const bit = 1 << next;
        if (mask & bit) continue;
        const nextMask = mask | bit;
        const candidate = current + matrix[last][next];
        if (candidate < costs[nextMask][next]) { costs[nextMask][next] = candidate; previous[nextMask][next] = last; }
      }
    }
  }
  const full = states - 1;
  let last = 1;
  for (let index = 2; index < size; index++) if (costs[full][index] < costs[full][last]) last = index;
  const order: number[] = [];
  let mask = full;
  while (last >= 0) {
    order.push(last);
    const prior = previous[mask][last];
    mask ^= 1 << last;
    last = prior;
  }
  return order.reverse();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { coordinates?: Coordinate[]; start?: Coordinate };
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 50) return NextResponse.json({ error: "Provide between 2 and 50 properties." }, { status: 400 });
    if (coordinates.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) return NextResponse.json({ error: "Invalid coordinates." }, { status: 400 });

    const start = body.start;
    if (start && (!Number.isFinite(start[0]) || !Number.isFinite(start[1]))) return NextResponse.json({ error: "Invalid starting point." }, { status: 400 });
    const routePoints = start ? [start, ...coordinates] : coordinates;
    let matrix = routePoints.map(a => routePoints.map(b => distance(a, b)));
    let provider = "distance";
    try {
      const encoded = routePoints.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
      const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${encoded}?annotations=duration`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const data = await response.json() as { code?: string; durations?: Array<Array<number | null>> };
        if (data.code === "Ok" && data.durations) {
          matrix = data.durations.map((row, i) => row.map((value, j) => value ?? matrix[i][j]));
          provider = "osrm-driving-time";
        }
      }
    } catch { /* deterministic distance fallback */ }

    const order = routePoints.length <= 15 ? exactOpenRoute(matrix) : improve(nearestNeighbour(matrix), matrix);
    const totalSeconds = order.slice(1).reduce((sum, value, index) => sum + matrix[order[index]][value], 0);
    return NextResponse.json({ order: start ? order.slice(1).map(index => index - 1) : order, totalSeconds, provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Optimization failed." }, { status: 500 });
  }
}
