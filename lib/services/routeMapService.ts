import { getRouteMapCache } from "@/lib/repositories/routeMapRepository";

export async function loadCachedRouteGeometry(routeId?: string) {
  if (!routeId) return null;
  return getRouteMapCache(routeId);
}
