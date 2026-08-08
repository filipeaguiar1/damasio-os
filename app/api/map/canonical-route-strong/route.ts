import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as getReplicaSnapshot } from "../canonical-route/route";

export const dynamic = "force-dynamic";

type Point = { latitude: number; longitude: number };
type SnapshotStop = {
  visitId: string;
  routeOrder: number;
  latitude: number | null;
  longitude: number | null;
  [key: string]: unknown;
};

type Snapshot = {
  routeId: string;
  routeVersion: number;
  routeDate: string;
  origin: ({ label: string; address?: string | null } & Point) | null;
  orderedVisitIds: string[];
  routeOrder: Array<{ visitId: string; routeOrder: number }>;
  stops: SnapshotStop[];
  geometry: unknown;
  geometryStatus: string;
  updatedAt: string;
};

const uncachedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  cache: "no-store",
});

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical service read is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: uncachedFetch },
  }) as any;
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function hasEveryMember(availableIds: string[], requiredIds: string[]) {
  const available = new Set(availableIds);
  return requiredIds.every(id => available.has(id));
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function samePoint(left: Point | null, right: Point | null) {
  if (!left || !right) return left === right;
  return Math.abs(left.latitude - right.latitude) < 0.0000001
    && Math.abs(left.longitude - right.longitude) < 0.0000001;
}

async function geometryFor(request: NextRequest, origin: Snapshot["origin"], stops: SnapshotStop[]) {
  const mappedStops = stops.filter(stop => stop.latitude !== null && stop.longitude !== null);
  if (mappedStops.length !== stops.length) return { geometry: null, geometryStatus: "incomplete" };

  const first = mappedStops[0];
  const originMatchesFirst = Boolean(
    origin
    && first
    && samePoint(origin, { latitude: Number(first.latitude), longitude: Number(first.longitude) }),
  );
  const coordinates: Array<[number, number]> = [
    ...(!origin || originMatchesFirst ? [] : [[origin.longitude, origin.latitude] as [number, number]]),
    ...mappedStops.map(stop => [Number(stop.longitude), Number(stop.latitude)] as [number, number]),
  ];
  if (coordinates.length < 2) return { geometry: null, geometryStatus: "unavailable" };

  const url = new URL("/api/map/route", request.nextUrl.origin);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ coordinates }),
  });
  if (!response.ok) return { geometry: null, geometryStatus: "unavailable" };
  const result = await response.json() as { geometry?: unknown };
  return { geometry: result.geometry || null, geometryStatus: result.geometry ? "ready" : "unavailable" };
}

export async function GET(request: NextRequest) {
  try {
    // The existing authenticated handler remains the authorization boundary and
    // owns route resolution, tenant checks, Visit enrichment and geocoding.
    // Version/order/origin below use explicit no-store Supabase reads so a GET
    // Route Handler can never reuse a pre-mutation Data Cache entry.
    const replicaResponse = await getReplicaSnapshot(request);
    const replicaBody = await replicaResponse.json().catch(() => ({}));
    if (!replicaResponse.ok) {
      return NextResponse.json(replicaBody, {
        status: replicaResponse.status,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const snapshot = replicaBody as Snapshot;
    const service = serviceClient();
    const [stateResult, stopsResult, smartResult] = await Promise.all([
      service
        .from("route_order_state")
        .select("version")
        .eq("route_id", snapshot.routeId)
        .maybeSingle(),
      service
        .from("route_stops")
        .select("visit_id,position")
        .eq("route_id", snapshot.routeId)
        .order("position", { ascending: true }),
      service
        .from("employee_smart_route_state")
        .select("active,route_version,applied_order,origin_label,origin_latitude,origin_longitude,applied_at")
        .eq("route_id", snapshot.routeId)
        .maybeSingle(),
    ]);
    if (stateResult.error) throw new Error(stateResult.error.message);
    if (stopsResult.error) throw new Error(stopsResult.error.message);
    if (smartResult.error) throw new Error(smartResult.error.message);

    const routeVersion = Number(stateResult.data?.version || 0);
    const orderedVisitIds: string[] = (stopsResult.data || []).map((row: any) => String(row.visit_id));
    if (!Number.isInteger(routeVersion) || routeVersion < 1 || !orderedVisitIds.length) {
      throw new Error("Canonical service read did not return a valid versioned order.");
    }

    const replicaIds = snapshot.stops.map(stop => String(stop.visitId));
    // route_stops owns membership. A stale enrichment snapshot may still contain
    // a recently removed Visit; that is safe because the canonical list below
    // simply drops it. We only wait when a canonical Visit is genuinely missing
    // from the enrichment payload and therefore cannot yet be rendered safely.
    if (!hasEveryMember(replicaIds, orderedVisitIds)) {
      return NextResponse.json(
        { error: "Canonical Route membership is still converging. Retry this snapshot." },
        { status: 409, headers: { "Cache-Control": "no-store, max-age=0", "Retry-After": "1" } },
      );
    }

    // Route order/membership and Visit execution change on different clocks.
    // Always read execution state directly with the uncached service client so a
    // Start/Finish/Reset is visible even when routeVersion itself did not change.
    const executionResult = await service
      .from("visits")
      .select("id,status,scheduled_date,started_at,finished_at,duration_seconds")
      .in("id", orderedVisitIds);
    if (executionResult.error) throw new Error(executionResult.error.message);
    const executionById = new Map<string, any>(
      (executionResult.data || []).map((row: any) => [String(row.id), row]),
    );
    if (executionById.size !== orderedVisitIds.length) {
      throw new Error("Canonical Visit execution state is incomplete for this Route.");
    }

    const stopById = new Map(snapshot.stops.map(stop => [String(stop.visitId), stop]));
    const stops = orderedVisitIds.map((visitId, index) => {
      const stop = stopById.get(visitId)!;
      const execution = executionById.get(visitId)!;
      return {
        ...stop,
        routeOrder: index + 1,
        status: String(execution.status || stop.status || "scheduled"),
        scheduledDate: execution.scheduled_date || (stop as any).scheduledDate,
        startedAt: execution.started_at,
        finishedAt: execution.finished_at,
        durationSeconds: execution.duration_seconds,
      };
    });

    const smartRow = smartResult.data || null;
    const smartLatitude = numberOrNull(smartRow?.origin_latitude);
    const smartLongitude = numberOrNull(smartRow?.origin_longitude);
    const smartOrder = Array.isArray(smartRow?.applied_order) ? smartRow.applied_order.map(String) : [];
    const smartIsCurrent = Boolean(
      smartRow?.active
      && Number(smartRow.route_version) === routeVersion
      && sameOrder(smartOrder, orderedVisitIds)
      && smartLatitude !== null
      && smartLongitude !== null,
    );
    const origin = smartIsCurrent
      ? {
          label: String(smartRow.origin_label || "Route start"),
          address: null,
          latitude: smartLatitude!,
          longitude: smartLongitude!,
        }
      : snapshot.origin;

    const orderChanged = !sameOrder(snapshot.orderedVisitIds, orderedVisitIds)
      || Number(snapshot.routeVersion) !== routeVersion;
    const originChanged = !samePoint(snapshot.origin, origin);
    let geometry = snapshot.geometry;
    let geometryStatus = snapshot.geometryStatus;
    if (orderChanged || originChanged) {
      const refreshed = await geometryFor(request, origin, stops);
      geometry = refreshed.geometry;
      geometryStatus = refreshed.geometryStatus;
    }

    console.info("canonical-route-service-snapshot-ok", {
      routeId: snapshot.routeId,
      routeVersion,
      enrichedVersion: snapshot.routeVersion,
      serviceOverride: orderChanged || originChanged,
      freshExecutionCount: executionById.size,
      stopCount: stops.length,
      geometryStatus,
    });

    return NextResponse.json({
      ...snapshot,
      routeVersion,
      origin,
      orderedVisitIds,
      routeOrder: orderedVisitIds.map((visitId, index) => ({ visitId, routeOrder: index + 1 })),
      stops,
      geometry,
      geometryStatus,
      updatedAt: smartIsCurrent && smartRow?.applied_at ? String(smartRow.applied_at) : snapshot.updatedAt,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("canonical-route-service-snapshot", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical Route could not be loaded consistently." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
