import { getRouteMapCache } from "@/lib/repositories/routeMapRepository";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Lead } from "@/lib/storage";

type PropertyRow = { address_line1: string | null; city: string | null; province: string | null; postal_code: string | null; latitude: number | null; longitude: number | null };
type NamedRow = { full_name?: string | null; service_name?: string | null };
type VisitMapRow = {
  id: string;
  route_id: string | null;
  property_id: string | null;
  route_order: number | null;
  scheduled_date?: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  properties: PropertyRow | PropertyRow[] | null;
  customers?: NamedRow | NamedRow[] | null;
  jobs?: NamedRow | NamedRow[] | null;
};
type DispatchBoardVisit = { id: string; routeId: string | null; crewName: string | null; customerName: string | null; propertyId: string | null; address: string | null; serviceName: string | null; scheduledDate: string; status: string; routeOrder: number | null; startedAt?: string | null; finishedAt?: string | null; durationSeconds?: number | null };

export type EmployeeRouteMapContext = { routeId: string | null; stops: Array<{ visitId: string; propertyId: string | null; addressLine1: string; latitude: number | null; longitude: number | null; routeOrder: number | null; status: string; customerName?: string; serviceName?: string; scheduledDate?: string; startedAt?: string; finishedAt?: string; durationSeconds?: number }> };
export type EmployeeDatabaseSmartRouteState = { routeId: string; crewId: string | null; routeDate: string; originalOrder: string[]; appliedOrder: string[]; originLabel: string; originLatitude?: number; originLongitude?: number; appliedAt: string; active: boolean; routeVersion: number };

const emptyContext: EmployeeRouteMapContext = { routeId: null, stops: [] };

export function routeDateForWeekday(dayName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const date = new Date();
  const current = (date.getDay() + 6) % 7;
  const target = days.indexOf(dayName);
  if (target >= 0) date.setDate(date.getDate() + target - current);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeAddress(value?: string | null) { return (value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function first<T>(value: T | T[] | null | undefined): T | undefined { return Array.isArray(value) ? value[0] : value || undefined; }
function stopFromRow(row: VisitMapRow) {
  const property = first(row.properties);
  const customer = first(row.customers);
  const job = first(row.jobs);
  return {
    visitId: row.id,
    propertyId: row.property_id,
    addressLine1: property?.address_line1 || "",
    latitude: property?.latitude ?? null,
    longitude: property?.longitude ?? null,
    routeOrder: row.route_order,
    status: row.status,
    customerName: customer?.full_name || "Customer",
    serviceName: job?.service_name || "Property Service",
    scheduledDate: row.scheduled_date || undefined,
    startedAt: row.started_at || undefined,
    finishedAt: row.finished_at || undefined,
    durationSeconds: row.duration_seconds ?? undefined
  };
}

async function loadCanonicalCrewVisits(routeDate: string, crewId: string, routeId: string | null): Promise<EmployeeRouteMapContext> {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("visits")
    .select("id,route_id,property_id,route_order,scheduled_date,status,started_at,finished_at,duration_seconds,properties(address_line1,city,province,postal_code,latitude,longitude),customers(full_name),jobs(service_name)")
    .eq("crew_id", crewId)
    .eq("scheduled_date", routeDate)
    .order("route_order", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const rows = ((data || []) as VisitMapRow[]).filter(row => !["cancelled", "missed"].includes(row.status));
  return { routeId: routeId || rows.find(row => row.route_id)?.route_id || null, stops: rows.map(stopFromRow) };
}

export async function loadEmployeeRouteMapContext(routeDate: string, crewName: string): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !crewName || !isSupabaseConfigured()) return emptyContext;
  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data: crew, error: crewError } = await supabase.from("crews").select("id").eq("name", crewName).eq("active", true).maybeSingle();
    if (crewError || !crew?.id) return loadPublishedEmployeeRoute(routeDate, crewName);

    const { data: route } = await supabase.from("routes").select("id").eq("crew_id", crew.id).eq("route_date", routeDate).order("created_at", { ascending: false }).limit(1).maybeSingle();

    // Canonical source is visits by crew and date. route_id is enrichment, not an eligibility requirement.
    const canonical = await loadCanonicalCrewVisits(routeDate, crew.id, route?.id || null);
    if (canonical.stops.length) return canonical;
    return loadPublishedEmployeeRoute(routeDate, crewName);
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
    const rows = visits.filter(visit => visit.crewName === crewName && visit.scheduledDate === routeDate && !["cancelled", "missed"].includes(visit.status)).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999));
    if (!rows.length) return emptyContext;
    return { routeId: rows.find(row => row.routeId)?.routeId || null, stops: rows.map(visit => ({ visitId: visit.id, propertyId: visit.propertyId, addressLine1: visit.address || "", latitude: null, longitude: null, routeOrder: visit.routeOrder, status: visit.status, customerName: visit.customerName || "Customer", serviceName: visit.serviceName || "Property Service", scheduledDate: visit.scheduledDate, startedAt: visit.startedAt || undefined, finishedAt: visit.finishedAt || undefined, durationSeconds: visit.durationSeconds ?? undefined })) };
  } catch { return emptyContext; }
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
      ...(lead || { id: stop.visitId, createdAt: new Date().toISOString(), name: stop.customerName || "Customer", phone: "", email: "", address: stop.addressLine1, service: stop.serviceName || "Property Service", status: "booked" as const, subtotal: 0, tax: 0, total: 0, photos: [] }),
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
      status: stop.status === "completed" || stop.status === "done" ? "completed" as const : "booked" as const
    };
  });
  return enriched.sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
}

export async function loadCachedRouteGeometry(routeId?: string) { return routeId ? getRouteMapCache(routeId) : null; }
function smartRouteStateFrom(row: any): EmployeeDatabaseSmartRouteState { return { routeId: row.route_id, crewId: row.crew_id || null, routeDate: row.route_date, originalOrder: Array.isArray(row.original_order) ? row.original_order : [], appliedOrder: Array.isArray(row.applied_order) ? row.applied_order : [], originLabel: row.origin_label || "", originLatitude: Number.isFinite(row.origin_latitude) ? Number(row.origin_latitude) : undefined, originLongitude: Number.isFinite(row.origin_longitude) ? Number(row.origin_longitude) : undefined, appliedAt: row.applied_at, active: Boolean(row.active), routeVersion: Number(row.route_version || 0) }; }
export async function loadEmployeeDatabaseSmartRouteState(routeId?: string | null): Promise<EmployeeDatabaseSmartRouteState | null> {
  if (!routeId || !isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("get_employee_smart_route_state", { p_route_id: routeId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? smartRouteStateFrom(row) : null;
}
export async function applyEmployeeDatabaseSmartRoute(params: { routeId: string; originalOrder: string[]; appliedOrder: string[]; origin: { label: string; latitude: number; longitude: number }; expectedVersion?: number | null }) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("apply_employee_smart_route", { p_route_id: params.routeId, p_original_order: params.originalOrder, p_applied_order: params.appliedOrder, p_origin_label: params.origin.label, p_origin_latitude: params.origin.latitude, p_origin_longitude: params.origin.longitude, p_expected_version: params.expectedVersion ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return Number(row?.route_version || 0);
}
export async function restoreEmployeeDatabaseSmartRoute(routeId: string, expectedVersion?: number | null) {
  if (!isSupabaseConfigured()) throw new Error("Database route mode is not configured.");
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("restore_employee_smart_route", { p_route_id: routeId, p_expected_version: expectedVersion ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return Boolean(row?.restored);
}
