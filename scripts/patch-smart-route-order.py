from pathlib import Path

path = Path('app/api/mobile/employee/smart-route/route.ts')
text = path.read_text()

old = '''function nearestOrder(count: number, matrix: Array<Array<number | null>>, alternative: number) {
  const remaining = Array.from({ length: count }, (_, index) => index + 1);
  const order: number[] = [];
  let cursor = 0;
  while (remaining.length) {
    const ranked = remaining.map(index => ({ index, value: Number(matrix[cursor]?.[index] ?? Number.POSITIVE_INFINITY) }))
      .sort((a, b) => a.value - b.value || a.index - b.index);
    const choiceIndex = order.length === 0 ? Math.min(alternative % Math.min(3, ranked.length), ranked.length - 1) : 0;
    const next = ranked[choiceIndex].index;
    order.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    cursor = next;
  }
  return order;
}

function twoOpt(input: number[], matrix: Array<Array<number | null>>) {
  let best = [...input];
  let bestCost = pathCost(best, matrix);
  let changed = true;
  for (let pass = 0; pass < 8 && changed; pass += 1) {
    changed = false;
    for (let left = 0; left < best.length - 1; left += 1) {
      for (let right = left + 1; right < best.length; right += 1) {
        const candidate = [...best.slice(0, left), ...best.slice(left, right + 1).reverse(), ...best.slice(right + 1)];
        const cost = pathCost(candidate, matrix);
        if (cost + 1 < bestCost) { best = candidate; bestCost = cost; changed = true; }
      }
    }
  }
  return best;
}
'''

new = '''function exactRoadOrder(count: number, matrix: Array<Array<number | null>>, alternative: number) {
  if (count < 1) return [];
  if (count > 18) throw new Error("Smart Route supports up to 18 houses at a time.");

  const starts = Array.from({ length: count }, (_, index) => index + 1)
    .sort((left, right) => Number(matrix[0]?.[left] ?? Number.POSITIVE_INFINITY) - Number(matrix[0]?.[right] ?? Number.POSITIVE_INFINITY));
  const forcedFirst = alternative > 0 ? starts[(alternative - 1) % starts.length] : null;
  const size = 1 << count;
  const width = count;
  const costs = new Float64Array(size * width);
  costs.fill(Number.POSITIVE_INFINITY);
  const parents = new Int16Array(size * width);
  parents.fill(-1);

  for (let stop = 0; stop < count; stop += 1) {
    const point = stop + 1;
    if (forcedFirst && point !== forcedFirst) continue;
    const edge = Number(matrix[0]?.[point] ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(edge)) costs[(1 << stop) * width + stop] = edge;
  }

  for (let mask = 1; mask < size; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      if (!(mask & (1 << last))) continue;
      const base = costs[mask * width + last];
      if (!Number.isFinite(base)) continue;
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const edge = Number(matrix[last + 1]?.[next + 1] ?? Number.POSITIVE_INFINITY);
        if (!Number.isFinite(edge)) continue;
        const nextMask = mask | (1 << next);
        const position = nextMask * width + next;
        const candidate = base + edge;
        if (candidate < costs[position]) {
          costs[position] = candidate;
          parents[position] = last;
        }
      }
    }
  }

  const fullMask = size - 1;
  let last = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const value = costs[fullMask * width + index];
    if (value < best) { best = value; last = index; }
  }
  if (last < 0 || !Number.isFinite(best)) throw new Error("A complete driving route could not be calculated for these houses.");

  const reversed: number[] = [];
  let mask = fullMask;
  while (last >= 0) {
    reversed.push(last + 1);
    const parent = parents[mask * width + last];
    mask ^= 1 << last;
    last = parent;
  }
  return reversed.reverse();
}
'''

if old not in text:
    raise SystemExit('optimizer block not found')
text = text.replace(old, new)
text = text.replace('''      const raw = nearestOrder(stops.length, matrix.distances, Math.max(0, Number(body.alternative || 0)));
      const order = twoOpt(raw, matrix.distances);''', '''      const order = exactRoadOrder(stops.length, matrix.durations, Math.max(0, Number(body.alternative || 0)));''')
text = text.replace('''    for (let index = 0; index < finalOrder.length; index += 1) {
      const { error } = await service.from("visits").update({ route_order: index + 1 }).eq("id", finalOrder[index]).eq("route_id", body.routeId);
      if (error) throw new Error(error.message);
    }''', '''    const previousOrders = new Map(visits.map((visit: any) => [visit.id, visit.route_order]));
    try {
      for (let index = 0; index < finalOrder.length; index += 1) {
        const { error } = await service.from("visits")
          .update({ route_order: 100000 + index })
          .eq("id", finalOrder[index])
          .eq("route_id", body.routeId);
        if (error) throw new Error(error.message);
      }
      for (let index = 0; index < finalOrder.length; index += 1) {
        const { error } = await service.from("visits")
          .update({ route_order: index + 1 })
          .eq("id", finalOrder[index])
          .eq("route_id", body.routeId);
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      for (const [visitId, routeOrder] of previousOrders) {
        await service.from("visits").update({ route_order: routeOrder }).eq("id", visitId).eq("route_id", body.routeId);
      }
      throw error;
    }''')
path.write_text(text)
