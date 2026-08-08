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

  const transactionalProjection = await service.rpc("sync_visit_route_order_for_route", {
    p_route_id: routeId,
  });
  if (!transactionalProjection.error) {
    const verified = await service
      .from("visits")
      .select("id,route_order,status")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .order("route_order", { ascending: true, nullsFirst: false });
    if (verified.error) throw new Error(verified.error.message);
    const projectedVisitIds = (verified.data || []).map((row: any) => String(row.id));
    const canonicalVisitIds = normalized.map(stop => stop.visitId);
    if (
      projectedVisitIds.length !== canonicalVisitIds.length
      || projectedVisitIds.some((visitId: string, index: number) => visitId !== canonicalVisitIds[index])
    ) {
      throw new Error("Canonical Visit projection helper returned without the exact route_stops order.");
    }
    return {
      fallback: true,
      transactional: true,
      routeId,
      count: normalized.length,
      orderedVisitIds: canonicalVisitIds,
    };
  }

  const helperMessage = String(transactionalProjection.error.message || "");
  if (!/sync_visit_route_order_for_route|schema cache|could not find the function|permission denied/i.test(helperMessage)) {
    throw new Error(helperMessage || "Canonical Route Visit projection helper failed.");
  }

  // Last-resort path for deployments that predate the transaction-level helper.
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
