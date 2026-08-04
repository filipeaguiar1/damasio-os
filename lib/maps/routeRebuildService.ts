import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Position, RouteBounds, RouteLineString } from "@/lib/maps/types";

type QueueRow = { route_id: string; company_id: string; attempts: number };
type VisitRow = {
  route_order: number | null;
  property_id: string | null;
  properties: { latitude: number | null; longitude: number | null } | null;
};

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Instant Map Engine requires server Supabase credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function boundsFor(points: Position[]): RouteBounds {
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return {
    south: Math.min(...latitudes), west: Math.min(...longitudes),
    north: Math.max(...latitudes), east: Math.max(...longitudes)
  };
}

async function roadGeometry(points: Position[]) {
  if (points.length < 2) return { geometry: null, distance: null, duration: null };
  const encoded = points.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`, {
      headers: { Accept: "application/json", "User-Agent": "DamasioOS/51.4.6" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
    const data = await response.json() as { code?: string; routes?: Array<{ geometry: RouteLineString; distance: number; duration: number }> };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error("Routing provider returned no route.");
    return { geometry: route.geometry, distance: route.distance, duration: route.duration };
  } finally {
    clearTimeout(timeout);
  }
}

async function rebuildOne(queue: QueueRow) {
  const supabase = serverClient() as any;
  const { data, error } = await supabase
    .from("visits")
    .select("route_order,property_id,properties(latitude,longitude)")
    .eq("route_id", queue.route_id)
    .or(`company_id.eq.${queue.company_id},organization_id.eq.${queue.company_id}`)
    .order("route_order", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  const visits = (data || []) as VisitRow[];
  const points = visits.flatMap((visit): Position[] => {
    const property = Array.isArray(visit.properties) ? visit.properties[0] : visit.properties;
    return property && Number.isFinite(property.longitude) && Number.isFinite(property.latitude)
      ? [[Number(property.longitude), Number(property.latitude)]] : [];
  });
  const pointsHash = createHash("sha256").update(JSON.stringify(points)).digest("hex");
  const { data: current } = await supabase.from("route_map_cache").select("points_hash,status").eq("route_id", queue.route_id).maybeSingle();

  if (current?.points_hash === pointsHash && current?.status === "ready") {
    await supabase.from("route_map_rebuild_queue").delete().eq("route_id", queue.route_id);
    return "unchanged";
  }

  const route = await roadGeometry(points);
  const status = points.length === 0 || points.length === 1 || route.geometry ? "ready" : "failed";
  const { error: saveError } = await supabase.from("route_map_cache").upsert({
    route_id: queue.route_id,
    company_id: queue.company_id,
    geometry: route.geometry,
    bounds: points.length ? boundsFor(points) : null,
    distance_meters: route.distance,
    duration_seconds: route.duration,
    points_hash: pointsHash,
    status,
    provider: route.geometry ? "osrm" : "coordinates_only",
    error_message: null,
    rebuilt_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "route_id" });
  if (saveError) throw new Error(saveError.message);
  await supabase.from("route_map_rebuild_queue").delete().eq("route_id", queue.route_id);
  return "rebuilt";
}

async function claimPendingRouteMaps(limit: number): Promise<QueueRow[]> {
  const supabase = serverClient() as any;
  const safeLimit = Math.max(1, Math.min(limit, 25));
  const claimed = await supabase.rpc("claim_route_map_rebuilds", { p_limit: safeLimit });
  if (!claimed.error) return (claimed.data || []) as QueueRow[];

  if (!/claim_route_map_rebuilds|schema cache|could not find the function/i.test(claimed.error.message || "")) {
    throw new Error(claimed.error.message);
  }

  const now = new Date().toISOString();
  const fallback = await supabase
    .from("route_map_rebuild_queue")
    .select("route_id,company_id,attempts")
    .is("locked_at", null)
    .lte("requested_at", now)
    .order("requested_at", { ascending: true })
    .limit(safeLimit);
  if (fallback.error) throw new Error(fallback.error.message);

  const rows = (fallback.data || []) as QueueRow[];
  const locked: QueueRow[] = [];
  for (const row of rows) {
    const result = await supabase
      .from("route_map_rebuild_queue")
      .update({ locked_at: now })
      .eq("route_id", row.route_id)
      .is("locked_at", null)
      .select("route_id")
      .maybeSingle();
    if (!result.error && result.data) locked.push(row);
  }
  return locked;
}

export async function rebuildPendingRouteMaps(limit = 10) {
  const supabase = serverClient() as any;
  const queues = await claimPendingRouteMaps(limit);

  const results: Array<{ routeId: string; result: string }> = [];
  for (const queue of queues) {
    try {
      const result = await rebuildOne(queue);
      results.push({ routeId: queue.route_id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Route rebuild failed";
      await supabase.from("route_map_rebuild_queue").update({
        attempts: queue.attempts + 1,
        locked_at: null,
        last_error: message,
        requested_at: new Date(Date.now() + Math.min(300_000, 15_000 * (queue.attempts + 1))).toISOString()
      }).eq("route_id", queue.route_id);
      await supabase.from("route_map_cache").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("route_id", queue.route_id);
      results.push({ routeId: queue.route_id, result: "failed" });
    }
  }
  return results;
}
