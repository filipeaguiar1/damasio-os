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

type EmployeeOperationalStop = {
  visitId: string;
  jobId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  addressLine1?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  routeOrder?: number | null;
  status?: string;
  customerName?: string;
  serviceName?: string;
  scheduledDate?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
};

async function accessToken(forceRefresh = false) {
  const supabase = getSupabaseBrowserClient() as any;
  if (forceRefresh) {
    const refreshed = await supabase.auth.refreshSession();
    const refreshedToken = refreshed.data?.session?.access_token;
    if (refreshedToken) return refreshedToken as string;
    if (refreshed.error) throw new Error(refreshed.error.message);
  }

  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) return token as string;
  if (error) throw new Error(error.message);

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data?.session?.access_token;
  if (!refreshedToken) throw new Error("Your session expired. Sign in again.");
  return refreshedToken as string;
}

async function authenticatedJson(path: string, token: string) {
  let currentToken = token;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(path, {
      headers: { authorization: `Bearer ${currentToken}` },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    if (response.status === 401 && attempt === 0) {
      currentToken = await accessToken(true);
      continue;
    }
    throw new Error(result.error || `Route request failed (${response.status}).`);
  }
  throw new Error("Route request failed after session refresh.");
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

async function geocodeAddress(address: string) {
  if (!address.trim()) return null;
  try {
    const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const point = await response.json() as { latitude?: number; longitude?: number };
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
    return { latitude: Number(point.latitude), longitude: Number(point.longitude) };
  } catch {
    return null;
  }
}

async function hydrateCoordinates(snapshot: CanonicalRouteSnapshot): Promise<CanonicalRouteSnapshot> {
  const stops = await Promise.all(snapshot.stops.map(async stop => {
    if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) return stop;
    const point = await geocodeAddress(stop.address);
    return point ? { ...stop, ...point } : stop;
  }));
  const mapped = stops.filter(stop => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
  return {
    ...snapshot,
    stops,
    geometryStatus: snapshot.geometry?.coordinates?.length
      ? "ready"
      : mapped.length === stops.length && stops.length > 0
        ? "incomplete"
        : "unavailable",
  };
}

async function resolveEmployeeRouteId(routeDate: string, token: string) {
  const result = await authenticatedJson(
    `/api/employee/canonical-route?date=${encodeURIComponent(routeDate)}`,
    token,
  );
  const routeId = String(result.routeId || "").trim();
  if (!routeId) throw new Error("The Employee route resolver returned no routeId.");
  return routeId;
}

function operationalAddress(stop: EmployeeOperationalStop) {
  return [stop.addressLine1, stop.city, stop.province, stop.postalCode]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

async function operationalEmployeeSnapshot(routeDate: string, token: string): Promise<CanonicalRouteSnapshot> {
  const result = await authenticatedJson(
    `/api/mobile/employee/route?date=${encodeURIComponent(routeDate)}`,
    token,
  ) as { routeId?: string | null; employee?: { id?: string; crewId?: string | null }; stops?: EmployeeOperationalStop[] };
  const routeId = String(result.routeId || "").trim();
  const sourceStops = Array.isArray(result.stops) ? result.stops : [];
  if (!routeId || !sourceStops.length) throw new Error("No route is assigned for this date.");

  const ordered = sourceStops
    .slice()
    .sort((left, right) => Number(left.routeOrder || 9999) - Number(right.routeOrder || 9999)
      || String(left.visitId).localeCompare(String(right.visitId)));
  const stops: CanonicalRouteStop[] = ordered.map((stop, index) => ({
    visitId: String(stop.visitId),
    jobId: stop.jobId ? String(stop.jobId) : null,
    routeId,
    customerId: stop.customerId ? String(stop.customerId) : null,
    propertyId: stop.propertyId ? String(stop.propertyId) : null,
    employeeId: result.employee?.id ? String(result.employee.id) : null,
    crewId: result.employee?.crewId ? String(result.employee.crewId) : null,
    address: operationalAddress(stop),
    latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : null,
    longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : null,
    routeOrder: index + 1,
    status: String(stop.status || "scheduled"),
    customerName: String(stop.customerName || "Customer"),
    serviceName: String(stop.serviceName || "Property Service"),
    scheduledDate: stop.scheduledDate || routeDate,
    startedAt: stop.startedAt || null,
    finishedAt: stop.finishedAt || null,
    durationSeconds: stop.durationSeconds ?? null,
  }));
  const orderedVisitIds = stops.map(stop => stop.visitId);
  return hydrateCoordinates({
    routeId,
    routeVersion: 1,
    routeDate,
    origin: null,
    orderedVisitIds,
    routeOrder: stops.map(stop => ({ visitId: stop.visitId, routeOrder: stop.routeOrder })),
    stops,
    geometry: null,
    geometryStatus: "incomplete",
    updatedAt: new Date().toISOString(),
  });
}

export async function loadCanonicalRouteSnapshot(input: {
  routeId?: string | null;
  routeDate?: string | null;
}): Promise<CanonicalRouteSnapshot> {
  let routeId = String(input.routeId || "").trim();
  const routeDate = String(input.routeDate || "").trim();
  if (!routeId && !routeDate) throw new Error("A routeId or route date is required.");

  const token = await accessToken();
  if (!routeId && routeDate) {
    try {
      routeId = await resolveEmployeeRouteId(routeDate, token);
    } catch {
      return operationalEmployeeSnapshot(routeDate, token);
    }
  }

  try {
    const result = await authenticatedJson(
      `/api/map/canonical-route?routeId=${encodeURIComponent(routeId)}`,
      token,
    );
    if (!validSnapshot(result)) throw new Error("The canonical route snapshot failed its identity check.");
    return hydrateCoordinates(result);
  } catch (error) {
    if (routeDate) return operationalEmployeeSnapshot(routeDate, token);
    throw error;
  }
}
