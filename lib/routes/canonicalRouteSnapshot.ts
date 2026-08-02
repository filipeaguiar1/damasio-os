"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RouteLineString } from "@/lib/maps/types";

export type CanonicalRouteOrigin = {
  label: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

export type CanonicalRouteStop = {
  visitId: string;
  jobId: string | null;
  routeId: string;
  customerId: string | null;
  propertyId: string | null;
  employeeId: string | null;
  crewId: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  routeOrder: number;
  status: string;
  customerName: string;
  serviceName: string;
  scheduledDate?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
};

export type CanonicalRouteSnapshot = {
  routeId: string;
  routeVersion: number;
  routeDate: string;
  origin: CanonicalRouteOrigin | null;
  orderedVisitIds: string[];
  routeOrder: Array<{ visitId: string; routeOrder: number }>;
  stops: CanonicalRouteStop[];
  geometry: RouteLineString | null;
  geometryStatus: "ready" | "incomplete" | "unavailable";
  updatedAt: string;
};

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token as string;
}

function validSnapshot(value: unknown): value is CanonicalRouteSnapshot {
  const snapshot = value as CanonicalRouteSnapshot | null;
  return Boolean(
    snapshot
    && snapshot.routeId
    && Number.isInteger(snapshot.routeVersion)
    && snapshot.routeVersion > 0
    && Array.isArray(snapshot.orderedVisitIds)
    && Array.isArray(snapshot.routeOrder)
    && Array.isArray(snapshot.stops)
    && snapshot.orderedVisitIds.length === snapshot.stops.length
    && snapshot.stops.every((stop, index) =>
      stop.visitId === snapshot.orderedVisitIds[index]
      && stop.routeOrder === index + 1),
  );
}

export async function loadCanonicalRouteSnapshot(input: {
  routeId?: string | null;
  routeDate?: string | null;
}): Promise<CanonicalRouteSnapshot> {
  const routeId = String(input.routeId || "").trim();
  const routeDate = String(input.routeDate || "").trim();
  if (!routeId && !routeDate) throw new Error("A routeId or route date is required.");

  const token = await accessToken();
  const query = new URLSearchParams();
  if (routeId) query.set("routeId", routeId);
  else query.set("date", routeDate);

  const response = await fetch(`/api/map/canonical-route?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "The canonical route could not be loaded.");
  }
  if (!validSnapshot(result)) {
    throw new Error("The canonical route snapshot failed its identity check.");
  }
  return result;
}
