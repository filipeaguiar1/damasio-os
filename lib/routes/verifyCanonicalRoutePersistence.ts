type CanonicalOriginExpectation = {
  label: string;
  latitude: number;
  longitude: number;
};

type CanonicalPersistenceExpectation = {
  routeId: string;
  orderedVisitIds: string[];
  routeVersion: number;
  origin: CanonicalOriginExpectation;
};

export type VerifiedCanonicalPersistence = {
  routeId: string;
  orderedVisitIds: string[];
  routeVersion: number;
  origin: CanonicalOriginExpectation;
};

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameCoordinate(left: number | null, right: number) {
  return left !== null && Math.abs(left - right) <= 0.0000001;
}

async function readCanonicalPersistence(service: any, routeId: string) {
  const [stateResult, stopsResult, smartResult] = await Promise.all([
    service
      .from("route_order_state")
      .select("version")
      .eq("route_id", routeId)
      .maybeSingle(),
    service
      .from("route_stops")
      .select("visit_id,position")
      .eq("route_id", routeId)
      .order("position", { ascending: true }),
    service
      .from("employee_smart_route_state")
      .select("active,route_version,applied_order,origin_label,origin_latitude,origin_longitude")
      .eq("route_id", routeId)
      .maybeSingle(),
  ]);

  if (stateResult.error) throw new Error(stateResult.error.message);
  if (stopsResult.error) throw new Error(stopsResult.error.message);
  if (smartResult.error) throw new Error(smartResult.error.message);

  return {
    routeVersion: Number(stateResult.data?.version || 0),
    orderedVisitIds: (stopsResult.data || []).map((row: any) => String(row.visit_id)),
    smart: smartResult.data || null,
  };
}

function assertCanonicalPersistence(
  persisted: Awaited<ReturnType<typeof readCanonicalPersistence>>,
  expected: CanonicalPersistenceExpectation,
) {
  const smartOrder = Array.isArray(persisted.smart?.applied_order)
    ? persisted.smart.applied_order.map(String)
    : [];
  const smartVersion = Number(persisted.smart?.route_version || 0);
  const originLabel = String(persisted.smart?.origin_label || "");
  const originLatitude = numeric(persisted.smart?.origin_latitude);
  const originLongitude = numeric(persisted.smart?.origin_longitude);

  if (
    persisted.routeVersion !== expected.routeVersion
    || !sameOrder(persisted.orderedVisitIds, expected.orderedVisitIds)
    || !persisted.smart?.active
    || smartVersion !== expected.routeVersion
    || !sameOrder(smartOrder, expected.orderedVisitIds)
    || originLabel !== expected.origin.label
    || !sameCoordinate(originLatitude, expected.origin.latitude)
    || !sameCoordinate(originLongitude, expected.origin.longitude)
  ) {
    console.error("canonical-route-persistence-mismatch", {
      routeId: expected.routeId,
      expectedVersion: expected.routeVersion,
      storedVersion: persisted.routeVersion,
      smartVersion,
      expectedOrder: expected.orderedVisitIds,
      storedOrder: persisted.orderedVisitIds,
      smartOrder,
      expectedOrigin: expected.origin,
      storedOrigin: {
        label: originLabel,
        latitude: originLatitude,
        longitude: originLongitude,
      },
      smartActive: Boolean(persisted.smart?.active),
    });
    throw new Error(
      "The canonical Route did not remain persisted with the reviewed order, origin and version.",
    );
  }
}

export async function verifyCanonicalRoutePersistence(
  service: any,
  expected: CanonicalPersistenceExpectation,
): Promise<VerifiedCanonicalPersistence> {
  // The second database read is intentionally delayed. It catches legacy
  // triggers or asynchronous projections that overwrite a successful RPC
  // immediately after the transaction returns.
  let persisted = await readCanonicalPersistence(service, expected.routeId);
  assertCanonicalPersistence(persisted, expected);

  await new Promise(resolve => setTimeout(resolve, 750));

  persisted = await readCanonicalPersistence(service, expected.routeId);
  assertCanonicalPersistence(persisted, expected);

  return {
    routeId: expected.routeId,
    orderedVisitIds: persisted.orderedVisitIds,
    routeVersion: persisted.routeVersion,
    origin: { ...expected.origin },
  };
}
