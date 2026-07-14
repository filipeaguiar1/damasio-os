import { getRouteMapCache } from "@/lib/repositories/routeMapRepository";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Lead } from "@/lib/storage";

type PropertyRow = {
  address_line1: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

type VisitMapRow = {
  id: string;
  route_id: string | null;
  property_id: string | null;
  route_order: number | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  properties: PropertyRow | PropertyRow[] | null;
};

type DispatchBoardVisit = {
  id: string;
  routeId: string | null;
  crewName: string | null;
  customerName: string | null;
  propertyId: string | null;
  address: string | null;
  serviceName: string | null;
  scheduledDate: string;
  status: string;
  routeOrder: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
};

export type EmployeeRouteMapContext = {
  routeId: string | null;
  stops: Array<{
    visitId: string;
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

const emptyContext: EmployeeRouteMapContext = { routeId: null, stops: [] };

export function routeDateForWeekday(dayName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const date = new Date();
  const current = (date.getDay() + 6) % 7;
  const target = days.indexOf(dayName);
  if (target >= 0) date.setDate(date.getDate() + target - current);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeAddress(value?: string | null) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertyFrom(row: VisitMapRow) {
  return Array.isArray(row.properties) ? row.properties[0] : row.properties;
}

export async function loadEmployeeRouteMapContext(routeDate: string, crewName: string): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !crewName || !isSupabaseConfigured()) return emptyContext;
  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data: crew, error: crewError } = await supabase
      .from("crews")
      .select("id")
      .eq("name", crewName)
      .eq("active", true)
      .maybeSingle();
    if (crewError || !crew?.id) return loadPublishedEmployeeRoute(routeDate, crewName);
    const { data: route, error: routeError } = await supabase
      .from("routes")
      .select("id")
      .eq("crew_id", crew.id)
      .eq("route_date", routeDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (routeError || !route?.id) return loadPublishedEmployeeRoute(routeDate, crewName);
    const { data, error } = await supabase
      .from("visits")
      .select("id,route_id,property_id,route_order,status,started_at,finished_at,duration_seconds,properties(address_line1,city,province,postal_code,latitude,longitude)")
      .eq("route_id", route.id)
      .order("route_order", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    const rows = (data || []) as VisitMapRow[];
    return {
      routeId: route.id,
      stops: rows.map(row => {
        const property = propertyFrom(row);
        return {
          visitId: row.id,
          propertyId: row.property_id,
          addressLine1: property?.address_line1 || "",
          latitude: property?.latitude ?? null,
          longitude: property?.longitude ?? null,
          routeOrder: row.route_order,
          status: row.status,
          startedAt: row.started_at || undefined,
          finishedAt: row.finished_at || undefined,
          durationSeconds: row.duration_seconds ?? undefined
        };
      })
    };
  } catch {
    return loadPublishedEmployeeRoute(routeDate, crewName);
  }
}

async function loadPublishedEmployeeRoute(routeDate: string, crewName: string): Promise<EmployeeRouteMapContext> {
  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data, error } = await supabase.rpc("get_scheduling_dispatch_board");
    if (error) return emptyContext;
    const visits = (Array.isArray(data?.visits) ? data.visits : []) as DispatchBoardVisit[];
    const rows = visits
      .filter(visit => visit.crewName === crewName && visit.scheduledDate === routeDate && !["cancelled", "missed"].includes(visit.status))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999));
    if (!rows.length) return emptyContext;
    return {
      routeId: null,
      stops: rows.map(visit => ({
        visitId: visit.id,
        propertyId: visit.propertyId,
        addressLine1: visit.address || "",
        latitude: null,
        longitude: null,
        routeOrder: visit.routeOrder,
        status: visit.status,
        customerName: visit.customerName || "Customer",
        serviceName: visit.serviceName || "Property Service",
        scheduledDate: visit.scheduledDate,
        startedAt: visit.startedAt || undefined,
        finishedAt: visit.finishedAt || undefined,
        durationSeconds: visit.durationSeconds ?? undefined
      }))
    };
  } catch {
    return emptyContext;
  }
}

export function applyEmployeeRouteMapContext(route: Lead[], context: EmployeeRouteMapContext) {
  if (!context.stops.length) return route;
  const enriched = context.stops.map(stop => {
    const propertyAddress = normalizeAddress(stop.addressLine1);
    const lead = route.find(candidate => {
      const leadAddress = normalizeAddress(candidate.address);
      return Boolean(propertyAddress && (leadAddress.includes(propertyAddress) || propertyAddress.includes(leadAddress)));
    });
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
        photos: []
      }),
      address: stop.addressLine1 || lead?.address || "",
      name: stop.customerName || lead?.name || "Customer",
      service: stop.serviceName || lead?.service || "Property Service",
      scheduledDate: stop.scheduledDate || lead?.scheduledDate,
      canonicalVisitId: stop.visitId,
      visitStartedAt: stop.startedAt || lead?.visitStartedAt,
      visitFinishedAt: stop.finishedAt || lead?.visitFinishedAt,
      visitDurationSeconds: stop.durationSeconds ?? lead?.visitDurationSeconds,
      latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : lead?.latitude,
      longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : lead?.longitude,
      routeOrder: stop.routeOrder ?? lead?.routeOrder,
      status: stop.status === "completed" ? "completed" as const : "booked" as const
    };
  });
  return enriched.sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
}

export async function loadCachedRouteGeometry(routeId?: string) {
  if (!routeId) return null;
  return getRouteMapCache(routeId);
}
