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

function storedAccessToken() {
  if (typeof window === "undefined") return null;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || "null");
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (typeof token === "string" && token.length > 20) return token;
    } catch {
      // A malformed unrelated storage value must not block the canonical route.
    }
  }
  return null;
}

async function accessToken() {
  const persisted = storedAccessToken();
  if (persisted) return persisted;

  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token || storedAccessToken();
  if (token) return token as string;
  if (error) throw new Error(error.message);

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data?.session?.access_token || storedAccessToken();
  if (!refreshedToken) throw new Error("Your session expired. Sign in again.");
  return refreshedToken as string;
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

async function resolveEmployeeRoute(routeDate: string, token: string) {
  const response = await fetch(`/api/employee/canonical-route?date=${encodeURIComponent(routeDate)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The Employee route could not be resolved.");
  const routeId = String(result.routeId || "").trim();
  if (!routeId) throw new Error("The Employee route resolver returned no routeId.");
  return {
    routeId,
    routeVersion: Number(result.routeVersion || 0),
  };
}

export async function loadCanonicalRouteSnapshot(input: {
  routeId?: string | null;
  routeDate?: string | null;
}): Promise<CanonicalRouteSnapshot> {
  let routeId = String(input.routeId || "").trim();
  const routeDate = String(input.routeDate || "").trim();
  if (!routeId && !routeDate) throw new Error("A routeId or route date is required.");

  const token = await accessToken();
  let resolvedVersion = 0;
  if (!routeId && routeDate) {
    const resolved = await resolveEmployeeRoute(routeDate, token);
    routeId = resolved.routeId;
    resolvedVersion = resolved.routeVersion;
  }

  const query = new URLSearchParams({ routeId });
  const response = await fetch(`/api/map/canonical-route-current?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The canonical route could not be loaded.");
  if (!validSnapshot(result)) throw new Error("The canonical route snapshot failed its identity check.");
  if (resolvedVersion > 0 && result.routeVersion < resolvedVersion) {
    throw new Error("The canonical route snapshot is older than the resolved routeVersion. Refresh and try again.");
  }
  return result;
}
