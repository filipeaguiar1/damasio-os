import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RouteVisit = Record<string, any>;

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
  return [property?.address_line1, property?.city, property?.province, property?.postal_code, "Canada"]
    .filter(Boolean)
    .join(", ");
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isRetiredDemoYork(visit: RouteVisit) {
  const property = joined(visit.properties);
  const customer = joined(visit.customers);
  const address = String(property?.address_line1 || "").trim().toLowerCase().replace(/\./g, "");
  const york = address === "55 york blvd" || address === "55 york boulevard";
  const demo = /^demo customer\b/i.test(String(customer?.full_name || ""))
    || /@4everseasons\.test$/i.test(String(customer?.email || ""))
    || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""));
  return york && demo;
}

function projectedOrder(visits: RouteVisit[]) {
  return [...visits]
    .sort((left, right) =>
      Number(left.route_order ?? 9999) - Number(right.route_order ?? 9999)
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || String(left.id).localeCompare(String(right.id)))
    .map(visit => String(visit.id));
}

async function writeCanonicalOrder(input: {
  service: any;
  companyId: string;
  routeId: string;
  profileId: string;
  order: string[];
  source: string;
}) {
  const removed = await input.service.from("route_stops").delete().eq("route_id", input.routeId);
  if (removed.error) throw new Error(removed.error.message);

  const cleared = await input.service
    .from("visits")
    .update({ route_order: null })
    .eq("route_id", input.routeId)
    .neq("status", "cancelled");
  if (cleared.error) throw new Error(cleared.error.message);

  if (input.order.length) {
    const inserted = await input.service.from("route_stops").insert(
      input.order.map((visitId: string, index: number) => ({
        company_id: input.companyId,
        route_id: input.routeId,
        visit_id: visitId,
        position: index + 1,
        updated_at: new Date().toISOString(),
      })),
    );
    if (inserted.error) throw new Error(inserted.error.message);
  }

  for (let index = 0; index < input.order.length; index += 1) {
    const updated = await input.service
      .from("visits")
      .update({ route_order: index + 1 })
      .eq("route_id", input.routeId)
      .eq("id", input.order[index]);
    if (updated.error) throw new Error(updated.error.message);
  }

  const currentVersion = await input.service
    .from("route_order_state")
    .select("version")
    .eq("route_id", input.routeId)
    .maybeSingle();
  const nextVersion = Number(currentVersion.error ? 1 : currentVersion.data?.version || 1) + 1;
  const orderState = await input.service.from("route_order_state").upsert({
    route_id: input.routeId,
    company_id: input.companyId,
    version: nextVersion,
    last_source: input.source,
    last_actor_profile_id: input.profileId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "route_id" });
  if (orderState.error) throw new Error(orderState.error.message);

  return nextVersion;
}

async function permanentlyRemoveRetiredDemoYork(input: {
  service: any;
  companyId: string;
  routeId: string;
  profileId: string;
  visits: RouteVisit[];
}) {
  const retired = input.visits.filter(isRetiredDemoYork);
  if (!retired.length || retired.some(visit => String(visit.status) === "in_progress")) return 0;

  const retiredIds = retired.map(visit => String(visit.id));
  const retiredSet = new Set(retiredIds);
  const remaining = input.visits.filter(visit => !retiredSet.has(String(visit.id)));
  const remainingSet = new Set(remaining.map(visit => String(visit.id)));
  const jobIds = unique(retired.map(visit => visit.job_id ? String(visit.job_id) : null));
  const customerIds = unique(retired.map(visit => visit.customer_id ? String(visit.customer_id) : null));

  const stored = await input.service
    .from("route_stops")
    .select("visit_id,position")
    .eq("route_id", input.routeId)
    .order("position");
  const storedOrder: string[] = stored.error
    ? []
    : (stored.data || [])
      .map((row: any) => String(row.visit_id))
      .filter((visitId: string) => remainingSet.has(visitId));
  const order = storedOrder.length === remaining.length ? storedOrder : projectedOrder(remaining);

  const cancelled = await input.service.from("visits").update({
    status: "cancelled",
    route_id: null,
    route_order: null,
    crew_id: null,
    assigned_employee_id: null,
    started_at: null,
    finished_at: null,
    duration_seconds: null,
  }).in("id", retiredIds);
  if (cancelled.error) throw new Error(cancelled.error.message);

  const nextVersion = await writeCanonicalOrder({ ...input, order, source: "remove_retired_demo_york" });
  const smartState = await input.service.from("employee_smart_route_state").update({
    original_order: order,
    applied_order: order,
    active: false,
    restored_at: new Date().toISOString(),
    restored_by_profile_id: input.profileId,
    route_version: nextVersion,
    updated_at: new Date().toISOString(),
  }).eq("route_id", input.routeId);
  if (smartState.error) throw new Error(smartState.error.message);

  if (jobIds.length) {
    const jobs = await input.service.from("jobs").update({ active: false }).in("id", jobIds);
    if (jobs.error) throw new Error(jobs.error.message);
  }
  if (customerIds.length) {
    const customers = await input.service
      .from("customers")
      .update({ archived_at: new Date().toISOString() })
      .in("id", customerIds);
    if (customers.error) throw new Error(customers.error.message);
  }

  try { await input.service.from("route_map_cache").delete().eq("route_id", input.routeId); } catch { /* optional cache */ }
  return retiredIds.length;
}

async function requireProfile(request: NextRequest, service: any) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to view this route.");

  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your session expired. Sign in again.");
  const profileResult = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,full_name,address_line1,route_start_address")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);

  const profile = profileResult.data;
  if (!profile?.active) throw new Error("This account is not active.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This account is not linked to a company.");
  return { profile, companyId: String(companyId) };
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
    if (!route || String(route.company_id || route.organization_id) !== companyId) {
      throw new Error("Route not found in this company.");
    }

    const loadVisits = async () => {
      const result = await service
        .from("visits")
        .select("id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,created_at,customers(full_name,email,notes),properties(address_line1,city,province,postal_code),jobs(service_name)")
        .eq("route_id", routeId)
        .neq("status", "cancelled")
        .or(companyFilter(companyId))
        .order("route_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (result.error) throw new Error(result.error.message);
      return (result.data || []) as RouteVisit[];
    };

    let rawVisits = await loadVisits();
    let removedRetiredDemoStops = 0;
    if (rawVisits.some(isRetiredDemoYork)) {
      try {
        removedRetiredDemoStops = await permanentlyRemoveRetiredDemoYork({
          service,
          companyId,
          routeId,
          profileId: String(profile.id),
          visits: rawVisits,
        });
        if (removedRetiredDemoStops) rawVisits = await loadVisits();
      } catch (cleanupError) {
        console.error("canonical-route-demo-cleanup", cleanupError);
      }
    }

    const visits = rawVisits.filter(visit => !isRetiredDemoYork(visit));
    const activeVisitIds = new Set(visits.map(visit => String(visit.id)));

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
        || visits.some(visit => visit.assigned_employee_id === currentEmployee.id)
      );
      if (!allowed) throw new Error("This route is not assigned to the authenticated Employee.");
    } else if (!["admin", "manager", "master"].includes(String(profile.role))) {
      throw new Error("This account cannot view operational routes.");
    }

    const [routeStopsResult, smartStateResult, orderStateResult] = await Promise.all([
      service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
      service.from("employee_smart_route_state")
        .select("route_id,applied_order,origin_label,origin_latitude,origin_longitude,active,route_version,updated_at")
        .eq("route_id", routeId)
        .maybeSingle(),
      service.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle(),
    ]);

    const smartState = smartStateResult.error ? null : smartStateResult.data;
    const canonicalVersion = Number(orderStateResult.error
      ? smartState?.route_version || 1
      : orderStateResult.data?.version || smartState?.route_version || 1);
    const routeStopOrder: string[] = routeStopsResult.error
      ? []
      : (routeStopsResult.data || [])
        .map((row: any) => String(row.visit_id))
        .filter((visitId: string) => activeVisitIds.has(visitId));
    const visitProjection = projectedOrder(visits);
    const canonicalOrder = routeStopOrder.length === visits.length ? routeStopOrder : visitProjection;
    const smartOrder: string[] = Array.isArray(smartState?.applied_order)
      ? smartState.applied_order.map(String).filter((visitId: string) => activeVisitIds.has(visitId))
      : [];
    const smartActive = Boolean(smartState?.active && sameOrder(smartOrder, canonicalOrder));
    const canonicalIndex = new Map<string, number>(
      canonicalOrder.map((visitId: string, index: number): [string, number] => [visitId, index]),
    );
    const orderedVisits = [...visits].sort((left, right) =>
      (canonicalIndex.get(String(left.id)) ?? 9999) - (canonicalIndex.get(String(right.id)) ?? 9999)
      || String(left.id).localeCompare(String(right.id)));

    const assignedEmployeeId = orderedVisits.find(visit => visit.assigned_employee_id)?.assigned_employee_id;
    let routeEmployee = currentEmployee;
    if (!routeEmployee && assignedEmployeeId) {
      const result = await service.from("employees")
        .select("id,profile_id,crew_id,full_name,address_line1,route_start_address,active")
        .eq("id", assignedEmployeeId)
        .maybeSingle();
      if (!result.error) routeEmployee = result.data;
    }
    if (!routeEmployee && route.crew_id) {
      const result = await service.from("employees")
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
      const result = await service.from("profiles")
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
            label: `${employeeProfile?.full_name || routeEmployee?.full_name || "Employee"} start`,
            address: fallbackOriginAddress,
          }
        : null;

    const stops = orderedVisits.map((visit, index) => {
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
      removedRetiredDemoStops,
      source: routeStopOrder.length === visits.length ? "route_stops" : "visit_projection",
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
