import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Lead } from "@/lib/storage";
import type { CanonicalRouteLead, CanonicalVisitStatus } from "@/lib/routes/canonicalRouteIdentity";
import type { RouteLineString } from "@/lib/maps/types";
import { normalizeVisitExecutionState } from "@/lib/visits/executionState";
import {
  loadCanonicalRouteSnapshot,
  type CanonicalRouteOrigin,
  type CanonicalRouteSnapshot,
  type CanonicalRouteStop,
} from "@/lib/routes/canonicalRouteSnapshot";

export type EmployeeRouteMapContext = {
  routeId: string | null;
  routeVersion?: number | null;
  routeDate?: string;
  origin?: CanonicalRouteOrigin | null;
  orderedVisitIds?: string[];
  routeOrder?: Array<{ visitId: string; routeOrder: number }>;
  geometry?: RouteLineString | null;
  geometryStatus?: CanonicalRouteSnapshot["geometryStatus"];
  stops: Array<{
    visitId: string;
    jobId?: string | null;
    customerId?: string | null;
    propertyId: string | null;
    addressLine1: string;
    latitude: number | null;
    longitude: number | null;
    routeOrder: number;
    status: string;
    customerName?: string;
    serviceName?: string;
    scheduledDate?: string;
    startedAt?: string;
    finishedAt?: string;
    durationSeconds?: number;
  }>;
};

export type EmployeeDatabaseSmartRouteState = {
  routeId: string;
  crewId: string | null;
  routeDate: string;
  originalOrder: string[];
  appliedOrder: string[];
  originLabel: string;
  originLatitude?: number;
  originLongitude?: number;
  appliedAt: string;
  active: boolean;
  routeVersion: number;
};

const emptyContext: EmployeeRouteMapContext = {
  routeId: null,
  routeVersion: null,
  origin: null,
  orderedVisitIds: [],
  routeOrder: [],
  geometry: null,
  stops: [],
};

function torontoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function routeDateForWeekday(dayName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const current = torontoParts();
  const currentIndex = days.indexOf(current.weekday);
  const targetIndex = days.indexOf(dayName);
  const base = new Date(Date.UTC(
    Number(current.year),
    Number(current.month) - 1,
    Number(current.day),
    17,
  ));
  if (currentIndex >= 0 && targetIndex >= 0) {
    base.setUTCDate(base.getUTCDate() + targetIndex - currentIndex);
  }
  const result = torontoParts(base);
  return `${result.year}-${result.month}-${result.day}`;
}

function contextStop(stop: CanonicalRouteStop) {
  const execution = normalizeVisitExecutionState({
    status: stop.status,
    startedAt: stop.startedAt,
    finishedAt: stop.finishedAt,
    durationSeconds: stop.durationSeconds,
  });
  return {
    visitId: stop.visitId,
    jobId: stop.jobId,
    customerId: stop.customerId,
    propertyId: stop.propertyId,
    addressLine1: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    routeOrder: stop.routeOrder,
    status: stop.status,
    customerName: stop.customerName,
    serviceName: stop.serviceName,
    scheduledDate: stop.scheduledDate,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationSeconds: execution.durationSeconds,
  };
}

function contextFromSnapshot(snapshot: CanonicalRouteSnapshot): EmployeeRouteMapContext {
  return {
    routeId: snapshot.routeId,
    routeVersion: snapshot.routeVersion,
    routeDate: snapshot.routeDate,
    origin: snapshot.origin,
    orderedVisitIds: [...snapshot.orderedVisitIds],
    routeOrder: snapshot.routeOrder.map(item => ({ ...item })),
    geometry: snapshot.geometry,
    geometryStatus: snapshot.geometryStatus,
    stops: snapshot.stops.map(contextStop),
  };
}

export async function loadEmployeeRouteMapContext(
  routeDate: string,
  _crewName: string,
): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !isSupabaseConfigured()) return emptyContext;
  const snapshot = await loadCanonicalRouteSnapshot({ routeDate });
  return contextFromSnapshot(snapshot);
}

export function applyEmployeeRouteMapContext(
  route: Lead[],
  context: EmployeeRouteMapContext,
): CanonicalRouteLead[] {
  const canonicalRouteId = context.routeId;
  if (!canonicalRouteId || !context.stops.length) return [];

  const byVisitId = new Map(
    route
      .filter(lead => Boolean(lead.canonicalVisitId))
      .map(lead => [lead.canonicalVisitId as string, lead]),
  );
  const byJobId = new Map(
    route
      .filter(lead => Boolean(lead.canonicalJobId))
      .map(lead => [lead.canonicalJobId as string, lead]),
  );

  return context.stops.map(stop => {
    const existing = byVisitId.get(stop.visitId)
      || (stop.jobId ? byJobId.get(stop.jobId) : undefined);
    const canonicalExisting = existing as CanonicalRouteLead | undefined;
    return {
      ...(existing || {
        id: stop.visitId,
        createdAt: stop.scheduledDate ? `${stop.scheduledDate}T12:00:00.000Z` : "1970-01-01T00:00:00.000Z",
        name: stop.customerName || "Customer",
        phone: "",
        email: "",
        address: stop.addressLine1,
        service: stop.serviceName || "Property Service",
        status: "booked" as const,
        subtotal: 0,
        tax: 0,
        total: 0,
        photos: [],
      }),
      id: stop.visitId,
      name: stop.customerName || existing?.name || "Customer",
      address: stop.addressLine1,
      service: stop.serviceName || existing?.service || "Property Service",
      scheduledDate: stop.scheduledDate || existing?.scheduledDate,
      canonicalVisitId: stop.visitId,
      canonicalRouteId,
      canonicalJobId: stop.jobId || existing?.canonicalJobId,
      canonicalCustomerId: stop.customerId || canonicalExisting?.canonicalCustomerId,
      canonicalPropertyId: stop.propertyId || canonicalExisting?.canonicalPropertyId,
      canonicalVisitStatus: stop.status as CanonicalVisitStatus,
      visitStartedAt: stop.startedAt,
      visitFinishedAt: stop.finishedAt,
      visitDurationSeconds: stop.durationSeconds,
      latitude: stop.latitude ?? undefined,
      longitude: stop.longitude ?? undefined,
      routeOrder: stop.routeOrder,
      status: stop.status === "completed" ? "completed" as const : "booked" as const,
    };
  });
}

function smartRouteStateFrom(row: any): EmployeeDatabaseSmartRouteState {
  return {
    routeId: row.route_id,
    crewId: row.crew_id || null,
    routeDate: row.route_date,
    originalOrder: Array.isArray(row.original_order) ? row.original_order.map(String) : [],
    appliedOrder: Array.isArray(row.applied_order) ? row.applied_order.map(String) : [],
    originLabel: row.origin_label || "",
    originLatitude: Number.isFinite(row.origin_latitude) ? Number(row.origin_latitude) : undefined,
    originLongitude: Number.isFinite(row.origin_longitude) ? Number(row.origin_longitude) : undefined,
    appliedAt: row.applied_at,
    active: Boolean(row.active),
    routeVersion: Number(row.route_version || 0),
  };
}

export async function loadEmployeeDatabaseSmartRouteState(
  routeId?: string | null,
): Promise<EmployeeDatabaseSmartRouteState | null> {
  if (!routeId || !isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("get_employee_smart_route_state", {
    p_route_id: routeId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? smartRouteStateFrom(row) : null;
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token as string;
}

async function canonicalOrderRequest(body: Record<string, unknown>) {
  const token = await accessToken();
  const response = await fetch("/api/map/canonical-route/order", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Canonical Route could not be saved.");
  return result as Record<string, any>;
}

export async function applyEmployeeDatabaseSmartRoute(params: {
  routeId: string;
  originalOrder: string[];
  appliedOrder: string[];
  origin: { label: string; latitude: number; longitude: number };
  expectedVersion?: number | null;
}) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const result = await canonicalOrderRequest({
    action: "apply",
    routeId: params.routeId,
    orderedVisitIds: params.appliedOrder,
    origin: params.origin,
    expectedVersion: params.expectedVersion ?? null,
  });
  return Number(result.routeVersion || result.version || 0);
}

export async function restoreEmployeeDatabaseSmartRoute(
  routeId: string,
  expectedVersion?: number | null,
) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const result = await canonicalOrderRequest({
    action: "restore",
    routeId,
    expectedVersion: expectedVersion ?? null,
  });
  return Boolean(result.restored);
}
