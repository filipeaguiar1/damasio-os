type CanonicalStopProjection = {
  visit_id: string;
  position: number;
};

/**
 * Server-side compatibility projection used only when the deployed database has
 * not exposed sync_canonical_route_stops_v2 to service_role yet.
 *
 * route_stops remains the only durable membership/order source. This helper
 * reads canonical stops and mirrors their positions into visits.route_order;
 * it never reads order from Visits and never mutates route_stops.
 */
export async function projectCanonicalVisitOrderCompatibility(service: any, routeId: string) {
  const stopsResult = await service
    .from("route_stops")
    .select("visit_id,position")
    .eq("route_id", routeId)
    .order("position", { ascending: true });

  if (stopsResult.error) throw new Error(stopsResult.error.message);
  const stops = (stopsResult.data || []) as CanonicalStopProjection[];
  if (!stops.length) throw new Error("Canonical Route has no stops to project.");

  for (const stop of stops) {
    const position = Number(stop.position);
    if (!stop.visit_id || !Number.isInteger(position) || position < 1) {
      throw new Error("Canonical Route contains an invalid stop projection.");
    }

    const visitResult = await service
      .from("visits")
      .update({ route_order: position })
      .eq("id", stop.visit_id)
      .eq("route_id", routeId)
      .select("id,route_order")
      .maybeSingle();

    if (visitResult.error) throw new Error(visitResult.error.message);
    if (!visitResult.data || Number(visitResult.data.route_order) !== position) {
      throw new Error(`Visit ${stop.visit_id} did not accept canonical route position ${position}.`);
    }
  }

  return {
    fallback: true,
    routeId,
    count: stops.length,
    orderedVisitIds: stops.map(stop => String(stop.visit_id)),
  };
}
