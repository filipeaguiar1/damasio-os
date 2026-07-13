import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RouteMapCache, RouteLineString, RouteBounds } from "@/lib/maps/types";

type CacheRow = {
  route_id: string;
  geometry: RouteLineString | null;
  bounds: RouteBounds | null;
  status: RouteMapCache["status"];
  rebuilt_at: string | null;
};

export async function getRouteMapCache(routeId: string): Promise<RouteMapCache | null> {
  if (!routeId) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("route_map_cache")
    .select("route_id,geometry,bounds,status,rebuilt_at")
    .eq("route_id", routeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as CacheRow | null;
  return row ? {
    routeId: row.route_id,
    geometry: row.geometry,
    bounds: row.bounds,
    status: row.status,
    rebuiltAt: row.rebuilt_at
  } : null;
}
