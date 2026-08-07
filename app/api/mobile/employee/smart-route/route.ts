import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyCanonicalRoutePersistence } from "@/lib/routes/verifyCanonicalRoutePersistence";

export const dynamic = "force-dynamic";

type Point = { id: string; latitude: number; longitude: number };
type Origin = { label: string; latitude: number; longitude: number };

function failure(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Smart Route failed." },
    { status },
  );
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Smart Route service is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function authClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Employee authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

async function context(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");

  const user = authClient(token);
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user) {
    throw new Error("Your Employee login expired. Sign in again.");
  }

  const service = serviceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError || !profile?.active || profile.role !== "employee") {
    throw new Error("This login is not an active Employee account.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This Employee is not linked to a company.");

  const { data: employee, error: employeeError } = await service
    .from("employees")
    .select("id,crew_id,active,company_id,organization_id")
    .eq("profile_id", auth.user.id)
    .eq("active", true)
    .maybeSingle();

  if (
    employeeError
    || !employee
    || (employee.company_id || employee.organization_id) !== companyId
  ) {
    throw new Error("No canonical Employee is linked to this login.");
  }

  return {
    service,
    employee,
    companyId: String(companyId),
    profileId: String(profile.id),
  };
}

async function allowedVisits(
  service: any,
  routeId: string,
  employee: any,
  companyId: string,
) {
  const { data, error } = await service
    .from("visits")
    .select("id,status,assigned_employee_id,crew_id,route_order")
    .eq("route_id", routeId)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .order("route_order", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  const visits = (data || []).filter((visit: any) =>
    String(visit.status) !== "cancelled"
    && (
      visit.assigned_employee_id === employee.id
      || (
        !visit.assigned_employee_id
        && employee.crew_id
        && visit.crew_id === employee.crew_id
      )
    ));

  if (!visits.length) {
    throw new Error("This route has no non-cancelled visits assigned to you.");
  }

  return visits;
}

const OSRM_TABLE_BATCH_SIZE = 45;

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
}

function pathCost(order: number[], matrix: Array<Array<number | null>>) {
  let total = 0;
  let previous = 0;

  for (const stop of order) {
    const value = matrix[previous]?.[stop];
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    total += Number(value);
    previous = stop;
  }

  return total;
}

function edgeCost(
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
}

function migrationMissing(message?: string) {
  return /apply_canonical_route_order_v2(?:_service)?|schema cache|could not find the function/i
    .test(message || "");
}

async function projectCanonicalVisitOrder(
  service: any,
  routeId: string,
  orderedVisitIds: string[],
) {
  const projected = await service.rpc("sync_canonical_route_stops_v2", {
    p_route_id: routeId,
    p_source: "employee_smart_route_projection",
  });
  if (!projected.error) return;

  const message = String(projected.error.message || "");
  if (!/permission denied|schema cache|could not find the function|does not exist/i.test(message)) {
    throw new Error(`Canonical Visit projection failed: ${message}`);
  }

  // Temporary compatibility for databases where the later one-way
  // projection migration has not rolled out yet. route_stops remains
  // authoritative; this approved writer only projects to Visits.
  const cleared = await service
    .from("visits")
    .update({ route_order: null })
    .eq("route_id", routeId)
    .neq("status", "cancelled");
  if (cleared.error) {
    throw new Error(`Canonical Visit projection reset failed: ${cleared.error.message}`);
  }

  for (let index = 0; index < orderedVisitIds.length; index += 1) {
    const written = await service
      .from("visits")
      .update({ route_order: index + 1 })
      .eq("route_id", routeId)
      .eq("id", orderedVisitIds[index]);
    if (written.error) {
      throw new Error(`Canonical Visit projection write failed: ${written.error.message}`);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, employee, companyId, profileId } = await context(request);
    const body = await request.json() as {
      action?: "optimize" | "apply";
      routeId?: string;
      origin?: Origin;
      stops?: Point[];
      alternative?: number;
      originalOrder?: string[];
      appliedOrder?: string[];
      expectedVersion?: number | null;
    };

    if (!body.routeId) throw new Error("A canonical route is required.");

    const visits = await allowedVisits(
      service,
      body.routeId,
      employee,
      companyId,
    );
    const allowed = new Set(visits.map((visit: any) => String(visit.id)));

    if (body.action === "optimize") {
      if (!body.origin || !Array.isArray(body.stops) || !body.stops.length) {
        throw new Error("Choose a starting point and at least one stop.");
      }

      const stops = body.stops.filter(stop =>
        allowed.has(stop.id)
        && Number.isFinite(stop.latitude)
        && Number.isFinite(stop.longitude));

      if (stops.length !== body.stops.length) {
        throw new Error("One or more stops do not belong to this Employee route.");
      }

      const matrix = await roadMatrix(body.origin, stops);
      const originDistances = (matrix.distances[0] || [])
        .slice(1)
        .filter((value): value is number => Number.isFinite(value));
      const nearestOriginDistance = originDistances.length
        ? Math.min(...originDistances)
        : Number.POSITIVE_INFINITY;

      if (!Number.isFinite(nearestOriginDistance) || nearestOriginDistance > 80000) {
        throw new Error(
          "The starting address was located too far from this route. Choose the full street address and city.",
        );
      }

      const inputIds = stops.map(stop => stop.id);
      const requestedAlternative = Math.max(0, Number(body.alternative || 0));
      let usedAlternative = requestedAlternative;
      let order = scalableRoadOrder(
        stops.length,
        matrix.durations,
        requestedAlternative,
      );
      let orderedIds = order.map(index => stops[index - 1].id);

      if (
        requestedAlternative > 0
        && orderedIds.every((id, index) => id === inputIds[index])
      ) {
        for (let offset = 1; offset <= stops.length; offset += 1) {
          const candidateAlternative = requestedAlternative + offset;
          const candidateOrder = scalableRoadOrder(
            stops.length,
            matrix.durations,
            candidateAlternative,
          );
          const candidateIds = candidateOrder
            .map(index => stops[index - 1].id);
          if (candidateIds.some((id, index) => id !== inputIds[index])) {
            usedAlternative = candidateAlternative;
            order = candidateOrder;
            orderedIds = candidateIds;
            break;
          }
        }
      }

      return NextResponse.json({
        orderedIds,
        distanceMeters: pathCost(order, matrix.distances),
        durationSeconds: pathCost(order, matrix.durations),
        alternative: usedAlternative,
        changed: orderedIds.some((id, index) => id !== inputIds[index]),
      });
    }

    if (body.action !== "apply") {
      throw new Error("Choose a valid Smart Route action.");
    }

    const requestedOrder = (body.appliedOrder || [])
      .map(String)
      .filter((id, index, values) =>
        allowed.has(id) && values.indexOf(id) === index);

    if (
      requestedOrder.length !== visits.length
      || visits.some((visit: any) => !requestedOrder.includes(String(visit.id)))
    ) {
      throw new Error(
        "The reviewed route must contain every non-cancelled house exactly once.",
      );
    }

    const origin = body.origin;
  if (
    !origin
    || !origin.label
    || !Number.isFinite(origin.latitude)
    || !Number.isFinite(origin.longitude)
  ) {
    throw new Error("A valid canonical Route origin is required.");
  }

  console.info("employee-smart-route-v2-request", {
    routeId: body.routeId,
    expectedVersion: body.expectedVersion ?? null,
    orderedVisitIds: requestedOrder,
    origin,
  });

  const { data, error } = await service.rpc("apply_canonical_route_order_v2_service", {
    p_route_id: body.routeId,
    p_ordered_visit_ids: requestedOrder,
    p_origin_label: origin.label,
    p_origin_latitude: origin.latitude,
    p_origin_longitude: origin.longitude,
    p_expected_version: body.expectedVersion ?? null,
    p_actor_profile_id: profileId,
    p_source: "employee_smart_route",
  });

    if (error) {
      if (migrationMissing(error.message)) {
        throw new Error(
          "The Canonical Route Stops V2 database migration is not installed.",
        );
      }
      throw new Error(error.message);
    }

    const result = data as {
      saved?: boolean;
      routeId?: string;
      count?: number;
      version?: number;
      appliedOrder?: string[];
    } | null;

    if (
      !result?.saved
      || result.routeId !== body.routeId
      || result.count !== requestedOrder.length
      || !Array.isArray(result.appliedOrder)
      || result.appliedOrder.some((id, index) => id !== requestedOrder[index])
    ) {
      throw new Error("The database did not confirm the reviewed route.");
    }

    const routeVersion = Number(result.version || 0);
  if (!Number.isInteger(routeVersion) || routeVersion < 1) {
    throw new Error("The database did not confirm a canonical routeVersion.");
  }

  await projectCanonicalVisitOrder(service, body.routeId, requestedOrder);

  const verified = await verifyCanonicalRoutePersistence(service, {
    routeId: body.routeId,
    orderedVisitIds: requestedOrder,
    routeVersion,
    origin,
  });
  const response = {
    ...result,
    version: verified.routeVersion,
    routeVersion: verified.routeVersion,
    appliedOrder: verified.orderedVisitIds,
    orderedVisitIds: verified.orderedVisitIds,
    origin: verified.origin,
  };

    console.info("employee-smart-route-v2-applied", {
      routeId: response.routeId,
      count: response.count,
      version: response.version,
      appliedOrder: response.appliedOrder,
      origin: response.origin,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("employee-smart-route", error);
    return failure(
      error,
      /expired|sign in|active Employee|linked/i.test(
        error instanceof Error ? error.message : "",
      ) ? 401 : 400,
    );
  }
}
