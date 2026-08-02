import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  return { service, user, employee, companyId: String(companyId) };
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

async function roadMatrix(origin: Origin, stops: Point[]) {
  const points = [origin, ...stops];
  const encoded = points
    .map(point => `${point.longitude},${point.latitude}`)
    .join(";");
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${encoded}?annotations=distance,duration`,
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

  if (result.code !== "Ok" || !result.distances || !result.durations) {
    throw new Error("Road distances could not be calculated.");
  }

  return { distances: result.distances, durations: result.durations };
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

function exactRoadOrder(
  count: number,
  matrix: Array<Array<number | null>>,
  alternative: number,
) {
  if (count < 1) return [];
  if (count > 18) {
    throw new Error("Smart Route supports up to 18 houses at a time.");
  }

  const starts = Array.from({ length: count }, (_, index) => index + 1)
    .sort((left, right) =>
      Number(matrix[0]?.[left] ?? Number.POSITIVE_INFINITY)
      - Number(matrix[0]?.[right] ?? Number.POSITIVE_INFINITY));
  const forcedFirst = alternative > 0 ? starts[alternative % starts.length] : null;
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
    if (value < best) {
      best = value;
      last = index;
    }
  }

  if (last < 0 || !Number.isFinite(best)) {
    throw new Error("A complete driving route could not be calculated for these houses.");
  }

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

function migrationMissing(message?: string) {
  return /apply_canonical_route_order_v2|schema cache|could not find the function/i
    .test(message || "");
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, employee, companyId } = await context(request);
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
      let order = exactRoadOrder(
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
          const candidateOrder = exactRoadOrder(
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

    const { data, error } = await user.rpc("apply_canonical_route_order_v2", {
      p_route_id: body.routeId,
      p_ordered_visit_ids: requestedOrder,
      p_origin_label: body.origin?.label || "",
      p_origin_latitude: body.origin?.latitude ?? null,
      p_origin_longitude: body.origin?.longitude ?? null,
      p_expected_version: body.expectedVersion ?? null,
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

    console.info("employee-smart-route-v2-applied", {
      routeId: result.routeId,
      count: result.count,
      version: result.version,
      appliedOrder: result.appliedOrder,
    });

    return NextResponse.json(result);
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
