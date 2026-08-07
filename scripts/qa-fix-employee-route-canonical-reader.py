from pathlib import Path

path = Path("app/api/mobile/employee/route/route.ts")
source = path.read_text()

anchor = '''  const propertyIds = unique(visits.map((visit: any) => visit.property_id));
  const customerIds = unique(visits.map((visit: any) => visit.customer_id));'''
replacement = '''  // route_stops is the canonical source of route order. visits.route_order is
  // only a compatibility projection and may lag while database migrations roll
  // out, so Employee web/mobile must never reconstruct a published route from it.
  const routeIds = unique(visits.map((visit: any) => visit.route_id));
  const routeStopsResult = routeIds.length
    ? await service
      .from("route_stops")
      .select("route_id,visit_id,position")
      .in("route_id", routeIds)
    : { data: [] as any[], error: null };
  if (routeStopsResult.error) throw new Error(routeStopsResult.error.message);

  const canonicalPositions = new Map<string, number>(
    (routeStopsResult.data || []).map((stop: any) => [
      `${String(stop.route_id)}:${String(stop.visit_id)}`,
      Number(stop.position),
    ]),
  );
  const canonicalPosition = (visit: any) => canonicalPositions.get(
    `${String(visit.route_id)}:${String(visit.id)}`,
  );

  visits.sort((left: any, right: any) => {
    const leftCanonical = canonicalPosition(left);
    const rightCanonical = canonicalPosition(right);
    const leftOrder = Number.isFinite(leftCanonical)
      ? Number(leftCanonical)
      : Number.isFinite(Number(left.route_order)) ? Number(left.route_order) : 2147483647;
    const rightOrder = Number.isFinite(rightCanonical)
      ? Number(rightCanonical)
      : Number.isFinite(Number(right.route_order)) ? Number(right.route_order) : 2147483647;
    return leftOrder - rightOrder
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || String(left.id).localeCompare(String(right.id));
  });

  const propertyIds = unique(visits.map((visit: any) => visit.property_id));
  const customerIds = unique(visits.map((visit: any) => visit.customer_id));'''
if anchor not in source:
    raise SystemExit("Employee Route property anchor not found")
source = source.replace(anchor, replacement, 1)

old = '''      routeOrder: visit.route_order,'''
new = '''      routeOrder: canonicalPosition(visit) ?? visit.route_order,'''
if old not in source:
    raise SystemExit("Employee Route routeOrder anchor not found")
source = source.replace(old, new, 1)

path.write_text(source)
