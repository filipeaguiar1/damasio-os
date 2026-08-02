import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Lead } from "@/lib/storage";
import type { CanonicalRouteLead, CanonicalVisitStatus } from "@/lib/routes/canonicalRouteIdentity";
import type { RouteLineString } from "@/lib/maps/types";
import { normalizeVisitExecutionState } from "@/lib/visits/executionState";

export type EmployeeRouteMapContext = {
  routeId: string | null;
  stops: Array<{
    visitId: string;
    jobId?: string | null;
    customerId?: string | null;
    propertyId: string | null;
    addressLine1: string;
    latitude: number | null;
    longitude: number | null;
    routeOrder: number | null;
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

const emptyContext: EmployeeRouteMapContext = { routeId: null, stops: [] };

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
  if (currentIndex >= 0 && targetIndex >= 0) base.setUTCDate(base.getUTCDate() + targetIndex - currentIndex);
  const result = torontoParts(base);
  return `${result.year}-${result.month}-${result.day}`;
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function loadEmployeeRouteMapContext(
  routeDate: string,
  _crewName: string,
): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !isSupabaseConfigured()) return emptyContext;

  const token = await accessToken();
  if (!token) return emptyContext;

  const response = await fetch(`/api/mobile/employee/route?date=${encodeURIComponent(routeDate)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Canonical Employee route could not be loaded.");
  }

  const result = await response.json() as {
    routeId?: string | null;
    stops?: Array<{
      visitId: string;
      jobId?: string | null;
      customerId?: string | null;
      propertyId?: string | null;
      addressLine1?: string;
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
    }>;
  };

  return {
    routeId: result.routeId || null,
    stops: (result.stops || []).map(stop => {
      const execution = normalizeVisitExecutionState({
        status: stop.status,
        startedAt: stop.startedAt,
        finishedAt: stop.finishedAt,
        durationSeconds: stop.durationSeconds,
      });

      return {
        visitId: stop.visitId,
        jobId: stop.jobId || null,
        customerId: stop.customerId || null,
        propertyId: stop.propertyId || null,
        addressLine1: stop.addressLine1 || "",
        latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : null,
        longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : null,
        routeOrder: stop.routeOrder ?? null,
        status: stop.status || "scheduled",
        customerName: stop.customerName || "Customer",
        serviceName: stop.serviceName || "Property Service",
        scheduledDate: stop.scheduledDate,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
        durationSeconds: execution.durationSeconds,
      };
    }),
  };
}

export function applyEmployeeRouteMapContext(route: Lead[], context: EmployeeRouteMapContext): CanonicalRouteLead[] {
  if (!context.stops.length) return [];

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

  return context.stops
    .map(stop => {
      const lead = byVisitId.get(stop.visitId)
        || (stop.jobId ? byJobId.get(stop.jobId) : undefined);
      const canonicalLead = lead as CanonicalRouteLead | undefined;

      return {
        ...(lead || {
          id: stop.visitId,
          createdAt: new Date().toISOString(),
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
        name: stop.customerName || lead?.name || "Customer",
        address: stop.addressLine1 || lead?.address || "",
        service: stop.serviceName || lead?.service || "Property Service",
        scheduledDate: stop.scheduledDate || lead?.scheduledDate,
        canonicalVisitId: stop.visitId,
        canonicalJobId: stop.jobId || lead?.canonicalJobId,
        canonicalCustomerId: stop.customerId || canonicalLead?.canonicalCustomerId,
        canonicalPropertyId: stop.propertyId || canonicalLead?.canonicalPropertyId,
        canonicalVisitStatus: stop.status as CanonicalVisitStatus,
        visitStartedAt: stop.startedAt,
        visitFinishedAt: stop.finishedAt,
        visitDurationSeconds: stop.durationSeconds,
        latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : undefined,
        longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : undefined,
        routeOrder: stop.routeOrder ?? undefined,
        status: stop.status === "completed" ? "completed" as const : "booked" as const,
      };
    })
    .sort((left, right) =>
      (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
      || left.canonicalVisitId!.localeCompare(right.canonicalVisitId!));
}

export async function loadCachedRouteGeometry(
  _routeId?: string,
): Promise<{ status?: string; geometry?: RouteLineString | null } | null> {
  // A route-id cache does not encode the current origin or waypoint coordinates.
  // Using it can overwrite the freshly calculated START → stop 1 → stop 2 geometry
  // after an address, origin, or route order changes. The map's coordinate-keyed
  // client cache remains safe and is used by EmployeeRouteMap before recalculation.
  return null;
}

function smartRouteStateFrom(row: any): EmployeeDatabaseSmartRouteState {
  return {
    routeId: row.route_id,
    crewId: row.crew_id || null,
    routeDate: row.route_date,
    originalOrder: Array.isArray(row.original_order) ? row.original_order : [],
    appliedOrder: Array.isArray(row.applied_order) ? row.applied_order : [],
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

export async function applyEmployeeDatabaseSmartRoute(params: {
  routeId: string;
  originalOrder: string[];
  appliedOrder: string[];
  origin: { label: string; latitude: number; longitude: number };
  expectedVersion?: number | null;
}) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("apply_employee_smart_route", {
    p_route_id: params.routeId,
    p_original_order: params.originalOrder,
    p_applied_order: params.appliedOrder,
    p_origin_label: params.origin.label,
    p_origin_latitude: params.origin.latitude,
    p_origin_longitude: params.origin.longitude,
    p_expected_version: params.expectedVersion ?? null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return Number(row?.route_version || 0);
}

export async function restoreEmployeeDatabaseSmartRoute(
  routeId: string,
  expectedVersion?: number | null,
) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("restore_employee_smart_route", {
    p_route_id: routeId,
    p_expected_version: expectedVersion ?? null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return Boolean(row?.restored);
}
