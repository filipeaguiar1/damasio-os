import { getRouteMapCache } from "@/lib/repositories/routeMapRepository";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Lead } from "@/lib/storage";
import type { CanonicalRouteLead, CanonicalVisitStatus } from "@/lib/routes/canonicalRouteIdentity";
import { normalizeVisitExecutionState } from "@/lib/visits/executionState";
import {
  beginMobileOperation,
  completeMobileOperation,
  failMobileOperation,
} from "@/lib/mobile/mobileOperationStatus";

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
const canonicalRouteVersions = new Map<string, number>();
const smartRoutePreviewVersions = new Map<string, number>();
let smartRouteApplyInFlight = false;

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

function clearLegacySmartRouteStates() {
  if (typeof window === "undefined") return;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("damasio_os_employee_smart_route_")) {
      window.localStorage.removeItem(key);
    }
  }
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

async function rememberCanonicalRouteVersion(routeId: string) {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("get_canonical_route_order_v2", {
    p_route_id: routeId,
  });
  if (error) {
    if (/get_canonical_route_order_v2|schema cache|could not find the function/i.test(error.message || "")) {
      throw new Error("The Canonical Route Stops V2 database migration is not installed.");
    }
    throw new Error(error.message);
  }
  const version = Number(data?.version || 0);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("The canonical Route version could not be loaded.");
  }
  canonicalRouteVersions.set(routeId, version);
  return version;
}

export async function loadEmployeeRouteMapContext(
  routeDate: string,
  _crewName: string,
): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !isSupabaseConfigured()) return emptyContext;

  const token = await accessToken();
  if (!token) return emptyContext;

  const response = await fetch(`/api/mobile/employee/today-route?date=${encodeURIComponent(routeDate)}`, {
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

  const routeId = result.routeId || null;
  const context = {
    routeId,
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
  } satisfies EmployeeRouteMapContext;

  if (routeId) {
    try {
      await rememberCanonicalRouteVersion(routeId);
    } catch (error) {
      console.warn("canonical-route-version-unavailable", error);
    }
  }

  return context;
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

export async function loadCachedRouteGeometry(routeId?: string) {
  if (!routeId) return null;
  return getRouteMapCache(routeId);
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
  if (!row) return null;

  const state = smartRouteStateFrom(row);
  if (state.routeVersion > 0) {
    canonicalRouteVersions.set(routeId, state.routeVersion);
  }
  if (!state.active) clearLegacySmartRouteStates();
  return state;
}

export async function optimizeEmployeeRoadRoute(params: {
  routeId: string;
  origin: { label: string; latitude: number; longitude: number };
  stops: Array<{ id: string; latitude: number; longitude: number }>;
  alternative?: number;
}) {
  const reviewedVersion = canonicalRouteVersions.get(params.routeId);
  if (!reviewedVersion) {
    throw new Error("Refresh the route before creating a Smart Route preview.");
  }

  const token = await accessToken();
  if (!token) throw new Error("Your Employee login expired. Sign in again.");
  const response = await fetch("/api/mobile/employee/smart-route", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "optimize", ...params }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Road Smart Route could not be calculated.");
  smartRoutePreviewVersions.set(params.routeId, reviewedVersion);
  return result as { orderedIds: string[]; distanceMeters: number; durationSeconds: number; alternative: number };
}

export async function applyEmployeeDatabaseSmartRoute(params: {
  routeId: string;
  originalOrder: string[];
  appliedOrder: string[];
  origin: { label: string; latitude: number; longitude: number };
  expectedVersion?: number | null;
}) {
  if (smartRouteApplyInFlight) {
    throw new Error("This route is already being saved. Please wait for confirmation.");
  }

  const reviewedVersion = smartRoutePreviewVersions.get(params.routeId)
    ?? params.expectedVersion
    ?? canonicalRouteVersions.get(params.routeId)
    ?? null;
  if (!reviewedVersion) {
    throw new Error("Refresh the route and create the preview again before applying it.");
  }

  smartRouteApplyInFlight = true;
  beginMobileOperation(
    "Saving Smart Route",
    `Confirming all ${params.appliedOrder.length} houses and updating every map…`,
  );

  try {
    const token = await accessToken();
    if (!token) throw new Error("Your Employee login expired. Sign in again.");

    const response = await fetch("/api/mobile/employee/smart-route", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "apply",
        routeId: params.routeId,
        originalOrder: params.originalOrder,
        appliedOrder: params.appliedOrder,
        origin: params.origin,
        expectedVersion: reviewedVersion,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Smart Route could not be applied.");
    }

    const confirmed = result as {
      saved: true;
      routeId: string;
      count: number;
      version: number;
      appliedOrder: string[];
    };
    canonicalRouteVersions.set(params.routeId, confirmed.version);

    completeMobileOperation(
      "Route saved",
      `${confirmed.count} houses are synchronized for Worker and Admin.`,
    );
    return confirmed;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Smart Route could not be applied.";
    failMobileOperation("Route not changed", message);
    throw error;
  } finally {
    smartRoutePreviewVersions.delete(params.routeId);
    smartRouteApplyInFlight = false;
  }
}

export async function restoreEmployeeDatabaseSmartRoute(
  routeId: string,
  expectedVersion?: number | null,
) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const reviewedVersion = expectedVersion
    ?? canonicalRouteVersions.get(routeId)
    ?? null;
  if (!reviewedVersion) {
    throw new Error("Refresh the route before restoring its original order.");
  }

  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("restore_employee_smart_route", {
    p_route_id: routeId,
    p_expected_version: reviewedVersion,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (row?.route_version) {
    canonicalRouteVersions.set(routeId, Number(row.route_version));
  }
  if (row?.restored) clearLegacySmartRouteStates();
  return Boolean(row?.restored);
}
