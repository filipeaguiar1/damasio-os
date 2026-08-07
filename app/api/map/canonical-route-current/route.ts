import { NextRequest } from "next/server";
import { GET as loadStrongSnapshot } from "../canonical-route-strong/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // UI consumers must read through the same strongly-consistent canonical
  // snapshot path used by the public canonical endpoint. Calling the base
  // handler directly bypasses middleware and can leave Admin/Employee screens
  // on an older routeVersion after a successful canonical write.
  const response = await loadStrongSnapshot(request);
  response.headers.set("Cache-Control", "no-store, max-age=0");

  if (!response.ok) return response;

  try {
    const snapshot = await response.clone().json() as Record<string, any>;
    console.info("canonical-route-current-ok", {
      routeId: String(snapshot.routeId || "") || null,
      routeVersion: Number(snapshot.routeVersion || 0),
      firstVisitId: snapshot.orderedVisitIds?.[0] || null,
      stopCount: snapshot.stops?.length || 0,
    });
  } catch (error) {
    console.warn("canonical-route-current-log", error);
  }

  return response;
}
