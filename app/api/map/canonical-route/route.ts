import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { RouteLineString } from "@/lib/maps/types";

export const dynamic = "force-dynamic";

const SERVICE_CENTER = { latitude: 43.2557, longitude: -79.8711 };
const SERVICE_VIEWBOX = "-80.35,43.65,-79.35,42.85";
const SERVICE_BBOX = "-80.35,42.85,-79.35,43.65";
const geocodeCache = new Map<string, { point: Point | null; expiresAt: number }>();
const geometryCache = new Map<string, { geometry: RouteLineString | null; expiresAt: number }>();

type Point = { latitude: number; longitude: number };
type RouteVisit = Record<string, any>;
type SnapshotStop = {
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

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical route snapshot service is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedAddress(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function completeAddress(property: any) {
  return [
    property?.address_line1,
    property?.city,
    property?.province,
    property?.postal_code,
    "Canada",
  ].filter(Boolean).join(", ");
}

function isRetiredYorkDemo(visit: RouteVisit) {
  const property = joined(visit.properties);
  const customer = joined(visit.customers);
  const address = normalizedAddress(property?.address_line1);
  return (address === "55 york blvd" || address === "55 york boulevard")
    && (
      /^demo customer\b/i.test(String(customer?.full_name || ""))
      || /@4everseasons\.test$/i.test(String(customer?.email || ""))
      || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""))
    );
}

async function requireProfile(request: NextRequest, service: any) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to view this route.");

  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your session expired. Sign in again.");

  const result = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,full_name,address_line1,route_start_address")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const profile = result.data;
  if (!profile?.active) throw new Error("This account is not active.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This account is not linked to a company.");
  return { profile, companyId: String(companyId) };
}

async function employeeForProfile(service: any, profileId: string, companyId: string) {
  const result = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
    .eq("profile_id", profileId)
    .eq("active", true)
    .or(companyFilter(companyId))
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function resolveRoute(input: {
  service: any;
  profile: any;
  companyId: string;
  routeId?: string | null;
  routeDate?: string | null;
}) {
  const { service, profile, companyId } = input;
  const role = String(profile.role);
  let employee: any = null;
  let route: any = null;

  if (role === "employee") {
    employee = await employeeForProfile(service, profile.id, companyId);
    if (!employee) throw new Error("No active Employee is linked to this login.");
  } else if (!["admin", "manager", "master"].includes(role)) {
    throw new Error("This account cannot view operational routes.");
  }

  if (input.routeId) {
    const result = await service
      .from("routes")
      .select("id,crew_id,route_date,company_id,organization_id,created_at")
      .eq("id", input.routeId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    route = result.data;
  } else {
    if (!input.routeDate) throw new Error("routeId or date is required.");
    if (!employee) throw new Error("Admin route reads require routeId.");

    const byCrew = await service
      .from("routes")
      .select("id,crew_id,route_date,company_id,organization_id,created_at")
      .eq("route_date", input.routeDate)
      .eq("crew_id", employee.crew_id)
      .or(companyFilter(companyId))
      .order("created_at", { ascending: true })
      .limit(2);
    if (byCrew.error) throw new Error(byCrew.error.message);
    if ((byCrew.data || []).length > 1) {
      throw new Error("More than one canonical Route exists for this Employee and date.");
    }
    route = byCrew.data?.[0] || null;

    if (!route) {
      const assigned = await service
        .from("visits")
        .select("route_id")
        .eq("scheduled_date", input.routeDate)
        .eq("assigned_employee_id", employee.id)
        .neq("status", "cancelled")
        .or(companyFilter(companyId));
      if (assigned.error) throw new Error(assigned.error.message);
      const routeIds = [...new Set<string>(
        (assigned.data || []).map((row: any) => String(row.route_id || "")).filter(Boolean),
      )];
      if (routeIds.length > 1) throw new Error("Employee Visits point to more than one Route for this date.");
      if (routeIds[0]) {
        const result = await service
          .from("routes")
          .select("id,crew_id,route_date,company_id,organization_id,created_at")
          .eq("id", routeIds[0])
          .maybeSingle();
        if (result.error) throw new Error(result.error.message);
        route = result.data;
      }
    }
  }

  if (!route || String(route.company_id || route.organization_id) !== companyId) {
    throw new Error("Canonical Route not found in this company.");
  }

  if (employee) {
    const assigned = await service
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("route_id", route.id)
      .eq("assigned_employee_id", employee.id)
      .neq("status", "cancelled");
    if (assigned.error) throw new Error(assigned.error.message);
    if (route.crew_id !== employee.crew_id && !assigned.count) {
      throw new Error("This Route is not assigned to the authenticated Employee.");
    }
  }

  return { route, employee };
}

function simulationPoint(address: string): Point | null {
  if (!/\bsimulation route\b/i.test(address)) return null;
  const center = /\boakville\b/i.test(address)
    ? { latitude: 43.4675, longitude: -79.6877 }
    : /\bburlington\b/i.test(address)
      ? { latitude: 43.3255, longitude: -79.7990 }
      : SERVICE_CENTER;
  let hash = 0;
  for (const character of address) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    latitude: center.latitude + ((hash % 2001) - 1000) / 100000,
    longitude: center.longitude + (((Math.floor(hash / 2001)) % 2001) - 1000) / 100000,
  };
}

async function photonPoint(address: string): Promise<Point | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", String(SERVICE_CENTER.latitude));
  url.searchParams.set("lon", String(SERVICE_CENTER.longitude));
  url.searchParams.set("bbox", SERVICE_BBOX);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "DamasioOS/CanonicalRouteSnapshot" },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json() as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const coordinates = data.features?.[0]?.geometry?.coordinates;
  const longitude = numeric(coordinates?.[0]);
  const latitude = numeric(coordinates?.[1]);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

async function nominatimPoint(address: string): Promise<Point | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("viewbox", SERVICE_VIEWBOX);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", address);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-CA,en;q=0.9",
      "User-Agent": "DamasioOS/CanonicalRouteSnapshot",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ lat?: string; lon?: string }>;
  const latitude = numeric(rows[0]?.lat);
  const longitude = numeric(rows[0]?.lon);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

async function geocodeAddress(address: string): Promise<Point | null> {
  const simulated = simulationPoint(address);
  if (simulated) return simulated;

  const key = normalizedAddress(address);
  if (!key) return null;
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.point;

  let point: Point | null = null;
  try { point = await photonPoint(address); } catch { /* fallback below */ }
  if (!point) {
    try { point = await nominatimPoint(address); } catch { /* unresolved */ }
  }
  geocodeCache.set(key, { point, expiresAt: Date.now() + (point ? 15 * 60_000 : 60_000) });
  return point;
}

async function roadGeometry(routeId: string, routeVersion: number, points: Point[]) {
  if (points.length < 2) return null;
  const signature = `${routeId}:${routeVersion}:${points.map(point => `${point.longitude},${point.latitude}`).join(";")}`;
  const cached = geometryCache.get(signature);
  if (cached && cached.expiresAt > Date.now()) return cached.geometry;

  const encoded = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`,
    {
      headers: { Accept: "application/json", "User-Agent": "DamasioOS/CanonicalRouteSnapshot" },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  const result = await response.json() as { code?: string; routes?: Array<{ geometry?: RouteLineString }> };
  const geometry = result.code === "Ok" ? result.routes?.[0]?.geometry || null : null;
  geometryCache.set(signature, { geometry, expiresAt: Date.now() + 60_000 });
  return geometry;
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every(value => expected.has(value));
}

export async function GET(request: NextRequest) {
  try {
    const routeId = request.nextUrl.searchParams.get("routeId")?.trim() || null;
    const routeDate = request.nextUrl.searchParams.get("date")?.trim() || null;
    const service = serviceClient();
    const { profile, companyId } = await requireProfile(request, service);
    const { route, employee } = await resolveRoute({ service, profile, companyId, routeId, routeDate });

    const [visitsResult, stopsResult, stateResult, smartResult] = await Promise.all([
      service
        .from("visits")
        .select("id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,created_at,customers(full_name,email,notes),properties(address_line1,city,province,postal_code),jobs(service_name)")
        .eq("route_id", route.id)
        .neq("status", "cancelled")
        .or(companyFilter(companyId)),
      service
        .from("route_stops")
        .select("visit_id,position")
        .eq("route_id", route.id)
        .order("position", { ascending: true }),
      service
        .from("route_order_state")
        .select("version,updated_at")
        .eq("route_id", route.id)
        .maybeSingle(),
      service
        .from("employee_smart_route_state")
        .select("origin_label,origin_latitude,origin_longitude,active,route_version,updated_at")
        .eq("route_id", route.id)
        .maybeSingle(),
    ]);

    if (visitsResult.error) throw new Error(visitsResult.error.message);
    if (stopsResult.error) throw new Error(stopsResult.error.message);
    if (stateResult.error || !stateResult.data) {
      throw new Error("Canonical route version is missing. Run the Route Stops migration.");
    }

    const visits = (visitsResult.data || []) as RouteVisit[];
    if (visits.some(isRetiredYorkDemo)) {
      throw new Error("Retired demo data remains on this Route. Run the 55 York cleanup migration.");
    }

    const activeVisitIds = visits.map(visit => String(visit.id));
    const stopRows = stopsResult.data || [];
    const orderedVisitIds: string[] = stopRows.map((row: any) => String(row.visit_id));
    const sequential = stopRows.every((row: any, index: number) => Number(row.position) === index + 1);
    if (
      new Set(orderedVisitIds).size !== orderedVisitIds.length
      || !sequential
      || !sameMembers(activeVisitIds, orderedVisitIds)
    ) {
      throw new Error("route_stops does not exactly match the active Visits. No projection fallback is allowed.");
    }

    const routeVersion = Number(stateResult.data.version);
    if (!Number.isInteger(routeVersion) || routeVersion < 1) {
      throw new Error("Canonical routeVersion is invalid.");
    }

    const byVisitId = new Map<string, RouteVisit>(visits.map(visit => [String(visit.id), visit]));
    const orderedVisits = orderedVisitIds.map(visitId => byVisitId.get(visitId)!);
    const stops: SnapshotStop[] = await Promise.all(orderedVisits.map(async (visit, index) => {
      const property = joined(visit.properties);
      const customer = joined(visit.customers);
      const job = joined(visit.jobs);
      const address = completeAddress(property);
      const point = await geocodeAddress(address);
      return {
        visitId: String(visit.id),
        jobId: visit.job_id || null,
        routeId: String(route.id),
        customerId: visit.customer_id || null,
        propertyId: visit.property_id || null,
        employeeId: visit.assigned_employee_id || null,
        crewId: visit.crew_id || null,
        address,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        routeOrder: index + 1,
        status: String(visit.status || "scheduled"),
        customerName: customer?.full_name || "Customer",
        serviceName: job?.service_name || "Property Service",
        scheduledDate: visit.scheduled_date,
        startedAt: visit.started_at,
        finishedAt: visit.finished_at,
        durationSeconds: visit.duration_seconds,
      };
    }));

    const smartState: any = smartResult.error ? null : smartResult.data;
    const smartOriginIsCurrent = Boolean(
      smartState?.active
      && Number(smartState.route_version) === routeVersion
      && numeric(smartState.origin_latitude) !== null
      && numeric(smartState.origin_longitude) !== null,
    );

    let routeEmployee = employee;
    if (!routeEmployee) {
      const employeeId = orderedVisits.find(visit => Boolean(visit.assigned_employee_id))?.assigned_employee_id;
      if (employeeId) {
        const result = await service
          .from("employees")
          .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
          .eq("id", employeeId)
          .maybeSingle();
        if (!result.error) routeEmployee = result.data;
      }
    }
    if (!routeEmployee && route.crew_id) {
      const result = await service
        .from("employees")
        .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
        .eq("crew_id", route.crew_id)
        .eq("active", true)
        .or(companyFilter(companyId))
        .limit(1)
        .maybeSingle();
      if (!result.error) routeEmployee = result.data;
    }

    let employeeProfile: any = null;
    if (routeEmployee?.profile_id) {
      const result = await service
        .from("profiles")
        .select("id,full_name,address_line1,route_start_address")
        .eq("id", routeEmployee.profile_id)
        .maybeSingle();
      if (!result.error) employeeProfile = result.data;
    }

    let origin: { label: string; address: string | null; latitude: number; longitude: number } | null = null;
    let originIsFirstStop = false;
    if (smartOriginIsCurrent) {
      origin = {
        label: smartState.origin_label || "Route start",
        address: null,
        latitude: Number(smartState.origin_latitude),
        longitude: Number(smartState.origin_longitude),
      };
    } else {
      const startAddress = employeeProfile?.route_start_address
        || employeeProfile?.address_line1
        || routeEmployee?.route_start_address
        || routeEmployee?.address_line1
        || "";
      const fullStartAddress = startAddress
        ? /\bcanada\b/i.test(startAddress) ? startAddress : `${startAddress}, Canada`
        : "";
      const startPoint = fullStartAddress ? await geocodeAddress(fullStartAddress) : null;
      if (startPoint) {
        origin = {
          label: `${employeeProfile?.full_name || routeEmployee?.full_name || "Employee"} start`,
          address: fullStartAddress,
          latitude: startPoint.latitude,
          longitude: startPoint.longitude,
        };
      } else {
        const first = stops[0];
        if (first && first.latitude !== null && first.longitude !== null) {
          originIsFirstStop = true;
          origin = {
            label: "First canonical stop",
            address: first.address,
            latitude: first.latitude,
            longitude: first.longitude,
          };
        }
      }
    }

    const allStopsMapped = stops.every(stop => stop.latitude !== null && stop.longitude !== null);
    const routePoints: Point[] = allStopsMapped
      ? [
          ...(!origin || originIsFirstStop ? [] : [{ latitude: origin.latitude, longitude: origin.longitude }]),
          ...stops.map(stop => ({ latitude: stop.latitude!, longitude: stop.longitude! })),
        ]
      : [];
    const geometry = routePoints.length >= 2
      ? await roadGeometry(String(route.id), routeVersion, routePoints)
      : null;
    const geometryStatus = !allStopsMapped ? "incomplete" : geometry ? "ready" : "unavailable";
    const updatedAt = [stateResult.data.updated_at, smartState?.updated_at, route.created_at]
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();

    console.info("canonical-route-snapshot-ok", {
      routeId: route.id,
      routeVersion,
      stopCount: stops.length,
      geometryStatus,
    });

    return NextResponse.json({
      routeId: String(route.id),
      routeVersion,
      routeDate: route.route_date,
      origin,
      orderedVisitIds,
      routeOrder: orderedVisitIds.map((visitId, index) => ({ visitId, routeOrder: index + 1 })),
      stops,
      geometry,
      geometryStatus,
      updatedAt,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("canonical-route-snapshot", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route snapshot could not be loaded." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
