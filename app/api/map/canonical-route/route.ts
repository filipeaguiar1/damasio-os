import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical route map service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function numeric(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function fullAddress(property: any) {
  return [
    property?.address_line1,
    property?.city,
    property?.province,
    property?.postal_code,
    "Canada",
  ].filter(Boolean).join(", ");
}

async function requireProfile(request: NextRequest, service: any) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to view this route.");

  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");

  const profileResult = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,full_name,address_line1,route_start_address")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);

  const profile = profileResult.data;
  if (!profile?.active) throw new Error("This account is not active.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This account is not linked to a company.");

  return { profile, companyId };
}

export async function GET(request: NextRequest) {
  try {
    const routeId = request.nextUrl.searchParams.get("routeId")?.trim();
    if (!routeId) return NextResponse.json({ error: "routeId is required." }, { status: 400 });

    const service = serviceClient();
    const { profile, companyId } = await requireProfile(request, service);

    const routeResult = await service
      .from("routes")
      .select("id,crew_id,route_date,company_id,organization_id")
      .eq("id", routeId)
      .maybeSingle();
    if (routeResult.error) throw new Error(routeResult.error.message);
    const route = routeResult.data;
    if (!route || (route.company_id || route.organization_id) !== companyId) {
      throw new Error("Route not found in this company.");
    }

    // Coordinates are intentionally not selected here. Some production tenants
    // predate the optional properties.latitude/longitude columns. Every client
    // receives the same complete canonical address and the shared map component
    // geocodes that address consistently when stored coordinates are unavailable.
    const visitsResult = await service
      .from("visits")
      .select("id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,created_at,customers(full_name),properties(address_line1,city,province,postal_code),jobs(service_name)")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .or(companyFilter(companyId))
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (visitsResult.error) throw new Error(visitsResult.error.message);
    const visits = visitsResult.data || [];

    let currentEmployee: any = null;
    if (String(profile.role) === "employee") {
      const employeeResult = await service
        .from("employees")
        .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
        .eq("profile_id", profile.id)
        .eq("active", true)
        .or(companyFilter(companyId))
        .maybeSingle();
      if (employeeResult.error) throw new Error(employeeResult.error.message);
      currentEmployee = employeeResult.data;
      const allowed = Boolean(currentEmployee) && (
        route.crew_id === currentEmployee.crew_id
        || visits.some((visit: any) => visit.assigned_employee_id === currentEmployee.id)
      );
      if (!allowed) throw new Error("This route is not assigned to the authenticated Employee.");
    } else if (!["admin", "manager", "master"].includes(String(profile.role))) {
      throw new Error("This account cannot view operational routes.");
    }

    const [routeStopsResult, smartStateResult, orderStateResult] = await Promise.all([
      service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
      service
        .from("employee_smart_route_state")
        .select("route_id,applied_order,origin_label,origin_latitude,origin_longitude,active,route_version,updated_at")
        .eq("route_id", routeId)
        .maybeSingle(),
      service.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle(),
    ]);

    const smartState = smartStateResult.error ? null : smartStateResult.data;
    const canonicalVersion = Number(orderStateResult.error
      ? (smartState?.route_version || 1)
      : (orderStateResult.data?.version || smartState?.route_version || 1));
    const smartActive = Boolean(
      smartState?.active
      && Number(smartState.route_version || 0) === canonicalVersion,
    );

    const routeStopOrder: string[] = routeStopsResult.error
      ? []
      : (routeStopsResult.data || []).map((row: any) => String(row.visit_id));
    const smartOrder: string[] = smartActive && Array.isArray(smartState?.applied_order)
      ? smartState.applied_order.map(String)
      : [];
    const preferredOrder: string[] = smartOrder.length ? smartOrder : routeStopOrder;
    const preferredIndex = new Map<string, number>(
      preferredOrder.map((visitId, index): [string, number] => [visitId, index]),
    );

    const orderedVisits = [...visits].sort((left: any, right: any) => {
      const leftIndex = preferredIndex.get(String(left.id));
      const rightIndex = preferredIndex.get(String(right.id));
      if (leftIndex !== undefined || rightIndex !== undefined) {
        if (leftIndex === undefined) return 1;
        if (rightIndex === undefined) return -1;
        return leftIndex - rightIndex;
      }
      return Number(left.route_order ?? 9999) - Number(right.route_order ?? 9999)
        || String(left.created_at || "").localeCompare(String(right.created_at || ""))
        || String(left.id).localeCompare(String(right.id));
    });

    const assignedEmployeeId = orderedVisits.find((visit: any) => visit.assigned_employee_id)?.assigned_employee_id;
    let routeEmployee = currentEmployee;
    if (!routeEmployee && assignedEmployeeId) {
      const result = await service
        .from("employees")
        .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
        .eq("id", assignedEmployeeId)
        .maybeSingle();
      if (!result.error) routeEmployee = result.data;
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

    const fallbackOriginAddress = employeeProfile?.route_start_address
      || employeeProfile?.address_line1
      || routeEmployee?.route_start_address
      || routeEmployee?.address_line1
      || "";
    const fallbackOriginLabel = `${employeeProfile?.full_name || routeEmployee?.full_name || "Employee"} start`;
    const smartLatitude = numeric(smartState?.origin_latitude);
    const smartLongitude = numeric(smartState?.origin_longitude);
    const origin = smartActive && smartLatitude !== null && smartLongitude !== null
      ? {
          latitude: smartLatitude,
          longitude: smartLongitude,
          label: smartState.origin_label || "Route start",
          address: null,
        }
      : fallbackOriginAddress
        ? {
            latitude: null,
            longitude: null,
            label: fallbackOriginLabel,
            address: fallbackOriginAddress,
          }
        : null;

    const stops = orderedVisits.map((visit: any, index: number) => {
      const property = joined(visit.properties);
      const customer = joined(visit.customers);
      const job = joined(visit.jobs);
      return {
        visitId: visit.id,
        jobId: visit.job_id,
        routeId: visit.route_id,
        customerId: visit.customer_id,
        propertyId: visit.property_id,
        employeeId: visit.assigned_employee_id,
        crewId: visit.crew_id,
        address: fullAddress(property),
        latitude: null,
        longitude: null,
        routeOrder: index + 1,
        status: String(visit.status || "scheduled"),
        customerName: customer?.full_name || "Customer",
        serviceName: job?.service_name || "Property Service",
        scheduledDate: visit.scheduled_date,
        startedAt: visit.started_at,
        finishedAt: visit.finished_at,
        durationSeconds: visit.duration_seconds,
      };
    });

    console.info("canonical-route-map-ok", {
      routeId,
      version: canonicalVersion,
      activeSmartRoute: smartActive,
      stopCount: stops.length,
      source: smartOrder.length ? "smart_route" : routeStopOrder.length ? "route_stops" : "visit_projection",
      completeAddressCount: stops.filter(stop => stop.address.split(",").length >= 3).length,
    });

    return NextResponse.json({
      routeId,
      routeDate: route.route_date,
      version: canonicalVersion,
      activeSmartRoute: smartActive,
      origin,
      stops,
    });
  } catch (error) {
    console.error("canonical-route-map", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route map could not be loaded." },
      { status: 400 },
    );
  }
}
