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

  const normalized = stops.map(stop => {
    const position = Number(stop.position);
    if (!stop.visit_id || !Number.isInteger(position) || position < 1) {
      throw new Error("Canonical Route contains an invalid stop projection.");
    }
    return { visitId: String(stop.visit_id), position };
  });

  // Two-phase projection avoids the unique (route, route_order) constraint while
  // positions are swapped. Temporary values are derived only from canonical
  // positions and are immediately replaced by the final canonical sequence.
  for (const stop of normalized) {
    const temporaryPosition = 1_000_000 + stop.position;
    const shifted = await service
      .from("visits")
      .update({ route_order: temporaryPosition })
      .eq("id", stop.visitId)
      .eq("route_id", routeId)
      .select("id,route_order")
      .maybeSingle();

    if (shifted.error) throw new Error(shifted.error.message);
    if (!shifted.data || Number(shifted.data.route_order) !== temporaryPosition) {
      throw new Error(`Visit ${stop.visitId} could not enter the canonical projection staging range.`);
    }
  }

  for (const stop of normalized) {
    const projected = await service
      .from("visits")
      .update({ route_order: stop.position })
      .eq("id", stop.visitId)
      .eq("route_id", routeId)
      .select("id,route_order")
      .maybeSingle();

    if (projected.error) throw new Error(projected.error.message);
    if (!projected.data || Number(projected.data.route_order) !== stop.position) {
      throw new Error(`Visit ${stop.visitId} did not accept canonical route position ${stop.position}.`);
    }
  }

  return {
    fallback: true,
    routeId,
    count: normalized.length,
    orderedVisitIds: normalized.map(stop => stop.visitId),
  };
}
