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

async function accessToken(forceRefresh = false) {
  const supabase = getSupabaseBrowserClient() as any;

  if (!forceRefresh) {
    const current = await supabase.auth.getSession();
    if (current.error) throw new Error(current.error.message);
    const session = current.data?.session;
    const expiresAt = Number(session?.expires_at || 0);
    const stillValid = Boolean(session?.access_token)
      && (!expiresAt || expiresAt * 1000 > Date.now() + 60_000);
    if (stillValid) return session.access_token as string;
  }

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw new Error(refreshed.error.message);
  const refreshedToken = refreshed.data?.session?.access_token;
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

async function authorizedJson(path: string, token: string) {
  let response = await fetch(path, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (response.status === 401) {
    const refreshedToken = await accessToken(true);
    response = await fetch(path, {
      headers: { authorization: `Bearer ${refreshedToken}` },
      cache: "no-store",
    });
  }

  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function resolveEmployeeRouteId(routeDate: string, token: string) {
  const path = `/api/employee/canonical-route?date=${encodeURIComponent(routeDate)}`;
  const { response, result } = await authorizedJson(path, token);
  if (!response.ok) throw new Error(result.error || "The Employee route could not be resolved.");
  const routeId = String(result.routeId || "").trim();
  if (!routeId) throw new Error("The Employee route resolver returned no routeId.");
  return routeId;
}

export async function loadCanonicalRouteSnapshot(input: {
  routeId?: string | null;
  routeDate?: string | null;
}): Promise<CanonicalRouteSnapshot> {
  let routeId = String(input.routeId || "").trim();
  const routeDate = String(input.routeDate || "").trim();
  if (!routeId && !routeDate) throw new Error("A routeId or route date is required.");

  const token = await accessToken();
  if (!routeId && routeDate) routeId = await resolveEmployeeRouteId(routeDate, token);

  const query = new URLSearchParams({ routeId });
  const { response, result } = await authorizedJson(`/api/map/canonical-route?${query.toString()}`, token);
  if (!response.ok) throw new Error(result.error || "The canonical route could not be loaded.");
  if (!validSnapshot(result)) throw new Error("The canonical route snapshot failed its identity check.");
  return result;
}
