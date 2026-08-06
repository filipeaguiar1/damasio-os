import { NextRequest } from "next/server";
import { GET as loadBaseSnapshot } from "../canonical-route/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const response = await loadBaseSnapshot(request);
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
