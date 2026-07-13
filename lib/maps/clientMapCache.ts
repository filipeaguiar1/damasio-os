import type { RouteLineString } from "@/lib/maps/types";

const ROUTE_PREFIX = "damasio_os_road_geometry_";

function routeKey(coordinates: Array<[number, number]>) {
  return ROUTE_PREFIX + coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
}

export function readRoadGeometry(coordinates: Array<[number, number]>) {
  if (typeof window === "undefined" || coordinates.length < 2) return null;
  try {
    const value = localStorage.getItem(routeKey(coordinates));
    return value ? JSON.parse(value) as RouteLineString : null;
  } catch { return null; }
}

export function saveRoadGeometry(coordinates: Array<[number, number]>, geometry: RouteLineString) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(routeKey(coordinates), JSON.stringify(geometry)); } catch { /* cache is optional */ }
}
