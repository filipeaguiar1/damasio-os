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
  properties: PropertyRow | PropertyRow[] | null;
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
    if (crewError || !crew?.id) return emptyContext;
    const { data: route, error: routeError } = await supabase
      .from("routes")
      .select("id")
      .eq("crew_id", crew.id)
      .eq("route_date", routeDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (routeError || !route?.id) return emptyContext;
    const { data, error } = await supabase
      .from("visits")
      .select("id,route_id,property_id,route_order,status,properties(address_line1,city,province,postal_code,latitude,longitude)")
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
          status: row.status
        };
      })
    };
  } catch {
    return emptyContext;
  }
}

export function applyEmployeeRouteMapContext(route: Lead[], context: EmployeeRouteMapContext) {
  if (!context.stops.length) return route;
  const enriched = route.map(lead => {
    const leadAddress = normalizeAddress(lead.address);
    const stop = context.stops.find(candidate => {
      const propertyAddress = normalizeAddress(candidate.addressLine1);
      return Boolean(propertyAddress && leadAddress.includes(propertyAddress));
    });
    if (!stop) return lead;
    return {
      ...lead,
      latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : lead.latitude,
      longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : lead.longitude,
      routeOrder: stop.routeOrder ?? lead.routeOrder,
      status: stop.status === "completed" ? "completed" as const : lead.status
    };
  });
  return enriched.sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
}

export async function loadCachedRouteGeometry(routeId?: string) {
  if (!routeId) return null;
  return getRouteMapCache(routeId);
}
