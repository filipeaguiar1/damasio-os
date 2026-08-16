import { NextRequest, NextResponse } from "next/server";
import { GET as loadStrongSnapshot } from "../canonical-route-strong/route";

export const dynamic = "force-dynamic";

function validPoint(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon)
    && !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function cleanGeometry(geometry: any) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  return geometry.coordinates.every((coordinate: unknown) =>
    Array.isArray(coordinate) && coordinate.length >= 2 && validPoint(coordinate[1], coordinate[0]))
    ? geometry : null;
}

export async function GET(request: NextRequest) {
  const response = await loadStrongSnapshot(request);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  if (!response.ok) return response;

  try {
    const snapshot = await response.clone().json() as Record<string, any>;
    const origin = snapshot.origin && validPoint(snapshot.origin.latitude, snapshot.origin.longitude)
      ? snapshot.origin : null;
    const stops = Array.isArray(snapshot.stops) ? snapshot.stops.map((stop: any) =>
      validPoint(stop.latitude, stop.longitude) ? stop : Object.assign({}, stop, { latitude: null, longitude: null })) : [];
    const geometry = cleanGeometry(snapshot.geometry);
    const geometryStatus = geometry ? (snapshot.geometryStatus || "ready")
      : stops.every((stop: any) => stop.latitude !== null && stop.longitude !== null) ? "unavailable" : "incomplete";
    const sanitized = Object.assign({}, snapshot, { origin, stops, geometry, geometryStatus });
    return NextResponse.json(sanitized, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return response;
  }
}
