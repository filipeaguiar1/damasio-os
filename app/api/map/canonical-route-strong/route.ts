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

function dedicatedPrimaryUrl(configuredUrl: string) {
  const url = new URL(configuredUrl);
  if (/^[^.]+-all\.supabase\.co$/i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/-all\.supabase\.co$/i, ".supabase.co");
  }
  return url.origin;
}

function primaryServiceClient() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configuredUrl || !key) throw new Error("Canonical primary read is not configured.");
  return createClient(dedicatedPrimaryUrl(configuredUrl), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(id => rightSet.has(id));
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
    // Version/order/origin below come from the exact canonical tables verified
    // by the writer, read server-side from the dedicated Primary API endpoint.
    const replicaResponse = await getReplicaSnapshot(request);
    const replicaBody = await replicaResponse.json().catch(() => ({}));
    if (!replicaResponse.ok) {
      return NextResponse.json(replicaBody, {
        status: replicaResponse.status,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const snapshot = replicaBody as Snapshot;
    const primary = primaryServiceClient();
    const [stateResult, stopsResult, smartResult] = await Promise.all([
      primary
        .from("route_order_state")
        .select("version")
        .eq("route_id", snapshot.routeId)
        .maybeSingle(),
      primary
        .from("route_stops")
        .select("visit_id,position")
        .eq("route_id", snapshot.routeId)
        .order("position", { ascending: true }),
      primary
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
      throw new Error("Primary canonical Route did not return a valid versioned order.");
    }

    const replicaIds = snapshot.stops.map(stop => String(stop.visitId));
    if (!sameMembers(replicaIds, orderedVisitIds)) {
      return NextResponse.json(
        { error: "Canonical Route membership is still converging from the Primary database. Retry this snapshot." },
        { status: 409, headers: { "Cache-Control": "no-store, max-age=0", "Retry-After": "1" } },
      );
    }

    const stopById = new Map(snapshot.stops.map(stop => [String(stop.visitId), stop]));
    const stops = orderedVisitIds.map((visitId, index) => ({
      ...stopById.get(visitId)!,
      routeOrder: index + 1,
    }));

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

    console.info("canonical-route-primary-snapshot-ok", {
      routeId: snapshot.routeId,
      routeVersion,
      replicaVersion: snapshot.routeVersion,
      primaryOverride: orderChanged || originChanged,
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
    console.error("canonical-route-primary-snapshot", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Primary canonical Route could not be loaded." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
