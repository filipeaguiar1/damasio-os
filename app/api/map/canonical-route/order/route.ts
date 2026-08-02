import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RouteOrigin = {
  label?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type OrderAction = "apply" | "restore" | "cleanup_demo_york";

type RequestBody = {
  action?: OrderAction;
  routeId?: string;
  orderedVisitIds?: string[];
  origin?: RouteOrigin | null;
  expectedVersion?: number | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical route writer is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Canonical route authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function missingCanonicalRpc(message?: string) {
  return /apply_canonical_route_order_v2|restore_canonical_route_order_v2|schema cache|could not find the function/i.test(message || "");
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every(value => expected.has(value));
}

function normalizeOrder(values?: string[]) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

async function requireProfile(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to change this route.");

  const service = serviceClient();
  const user = userClient(token);
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your session expired. Sign in again.");

  const profileResult = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profile = profileResult.data;
  if (!profile?.active) throw new Error("This account is not active.");

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This account is not linked to a company.");
  return { service, user, profile, companyId: String(companyId) };
}

async function routeAccess(service: any, profile: any, companyId: string, routeId: string) {
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

  if (String(profile.role) === "employee") {
    const employeeResult = await service
      .from("employees")
      .select("id,crew_id,active")
      .eq("profile_id", profile.id)
      .eq("active", true)
      .or(companyFilter(companyId))
      .maybeSingle();
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    const employee = employeeResult.data;
    if (!employee) throw new Error("No active Employee is linked to this login.");

    const assignedResult = await service
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId)
      .eq("assigned_employee_id", employee.id)
      .neq("status", "cancelled");
    if (assignedResult.error) throw new Error(assignedResult.error.message);

    if (route.crew_id !== employee.crew_id && !assignedResult.count) {
      throw new Error("This route is not assigned to the authenticated Employee.");
    }
  } else if (!["admin", "manager", "master"].includes(String(profile.role))) {
    throw new Error("This account cannot change operational routes.");
  }

  return route;
}

async function currentRouteData(service: any, companyId: string, routeId: string) {
  const [visitsResult, stopsResult, versionResult, stateResult] = await Promise.all([
    service
      .from("visits")
      .select("id,route_order,status,created_at")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .or(companyFilter(companyId))
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
    service.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle(),
    service.from("employee_smart_route_state").select("*").eq("route_id", routeId).maybeSingle(),
  ]);
  if (visitsResult.error) throw new Error(visitsResult.error.message);

  const visits = visitsResult.data || [];
  const visitIds = visits.map((visit: any) => String(visit.id));
  const stopOrder = stopsResult.error ? [] : (stopsResult.data || []).map((row: any) => String(row.visit_id));
  const currentOrder = sameMembers(visitIds, stopOrder) ? stopOrder : visitIds;
  const version = Number(versionResult.error ? 1 : versionResult.data?.version || 1);
  return {
    visits,
    visitIds,
    currentOrder,
    version,
    smartState: stateResult.error ? null : stateResult.data,
  };
}

async function directReplaceOrder(input: {
  service: any;
  profileId: string;
  companyId: string;
  route: any;
  orderedVisitIds: string[];
  origin?: RouteOrigin | null;
  expectedVersion?: number | null;
  source: string;
  active: boolean;
  originalOrder?: string[];
}) {
  const { service, profileId, companyId, route, orderedVisitIds, origin, source, active } = input;
  const routeId = String(route.id);
  const before = await currentRouteData(service, companyId, routeId);
  if (!sameMembers(before.visitIds, orderedVisitIds)) {
    throw new Error("The route must contain every active house exactly once.");
  }
  if (input.expectedVersion && input.expectedVersion > 0 && input.expectedVersion !== before.version) {
    throw new Error("Route changed on another device. Refresh and review it again.");
  }

  const inProgress = before.visits.some((visit: any) => String(visit.status) === "in_progress");
  if (inProgress) throw new Error("Finish the active house before changing this route.");

  const rollbackOrder = before.currentOrder;
  const nextVersion = before.version + 1;

  async function storeOrder(order: string[]) {
    const cleared = await service
      .from("visits")
      .update({ route_order: null })
      .eq("route_id", routeId)
      .neq("status", "cancelled");
    if (cleared.error) throw new Error(cleared.error.message);

    const removed = await service.from("route_stops").delete().eq("route_id", routeId);
    if (removed.error) throw new Error(removed.error.message);

    if (order.length) {
      const inserted = await service.from("route_stops").insert(order.map((visitId, index) => ({
        company_id: companyId,
        route_id: routeId,
        visit_id: visitId,
        position: index + 1,
        updated_at: new Date().toISOString(),
      })));
      if (inserted.error) throw new Error(inserted.error.message);
    }

    for (let index = 0; index < order.length; index += 1) {
      const updated = await service
        .from("visits")
        .update({ route_order: index + 1 })
        .eq("id", order[index])
        .eq("route_id", routeId);
      if (updated.error) throw new Error(updated.error.message);
    }
  }

  try {
    await storeOrder(orderedVisitIds);

    const orderState = await service.from("route_order_state").upsert({
      route_id: routeId,
      company_id: companyId,
      version: nextVersion,
      last_source: source,
      last_actor_profile_id: profileId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "route_id" });
    if (orderState.error) throw new Error(orderState.error.message);

    const previousOriginal = Array.isArray(before.smartState?.original_order)
      ? before.smartState.original_order.map(String)
      : [];
    const originalOrder = normalizeOrder(input.originalOrder?.length
      ? input.originalOrder
      : active && before.smartState?.active && previousOriginal.length
        ? previousOriginal
        : rollbackOrder);

    const smartState = await service.from("employee_smart_route_state").upsert({
      company_id: companyId,
      route_id: routeId,
      crew_id: route.crew_id,
      route_date: route.route_date,
      original_order: originalOrder,
      applied_order: orderedVisitIds,
      origin_label: origin?.label || before.smartState?.origin_label || "",
      origin_latitude: Number.isFinite(origin?.latitude) ? Number(origin?.latitude) : before.smartState?.origin_latitude ?? null,
      origin_longitude: Number.isFinite(origin?.longitude) ? Number(origin?.longitude) : before.smartState?.origin_longitude ?? null,
      active,
      applied_by_profile_id: profileId,
      applied_at: active ? new Date().toISOString() : before.smartState?.applied_at || null,
      restored_at: active ? null : new Date().toISOString(),
      restored_by_profile_id: active ? null : profileId,
      route_version: nextVersion,
      updated_at: new Date().toISOString(),
    }, { onConflict: "route_id" });
    if (smartState.error) throw new Error(smartState.error.message);

    const verified = await currentRouteData(service, companyId, routeId);
    if (verified.currentOrder.join("|") !== orderedVisitIds.join("|")) {
      throw new Error("Canonical route verification failed.");
    }

    return { saved: true, routeId, version: nextVersion, appliedOrder: orderedVisitIds, active };
  } catch (error) {
    try { await storeOrder(rollbackOrder); } catch { /* best-effort rollback */ }
    throw error;
  }
}

async function applyOrder(input: {
  service: any;
  user: any;
  profile: any;
  companyId: string;
  route: any;
  orderedVisitIds: string[];
  origin?: RouteOrigin | null;
  expectedVersion?: number | null;
}) {
  const rpc = await input.user.rpc("apply_canonical_route_order_v2", {
    p_route_id: input.route.id,
    p_ordered_visit_ids: input.orderedVisitIds,
    p_origin_label: input.origin?.label || "",
    p_origin_latitude: Number.isFinite(input.origin?.latitude) ? Number(input.origin?.latitude) : null,
    p_origin_longitude: Number.isFinite(input.origin?.longitude) ? Number(input.origin?.longitude) : null,
    p_expected_version: input.expectedVersion && input.expectedVersion > 0 ? input.expectedVersion : null,
    p_source: "employee_smart_route_global",
  });

  if (!rpc.error) {
    const result = rpc.data || {};
    return {
      saved: true,
      routeId: input.route.id,
      version: Number(result.version || result.routeVersion || 0),
      appliedOrder: result.appliedOrder || input.orderedVisitIds,
      active: true,
    };
  }
  if (!missingCanonicalRpc(rpc.error.message)) throw new Error(rpc.error.message);

  return directReplaceOrder({
    service: input.service,
    profileId: input.profile.id,
    companyId: input.companyId,
    route: input.route,
    orderedVisitIds: input.orderedVisitIds,
    origin: input.origin,
    expectedVersion: input.expectedVersion,
    source: "employee_smart_route_global_fallback",
    active: true,
  });
}

async function restoreOrder(input: {
  service: any;
  user: any;
  profile: any;
  companyId: string;
  route: any;
  expectedVersion?: number | null;
}) {
  const rpc = await input.user.rpc("restore_canonical_route_order_v2", {
    p_route_id: input.route.id,
    p_expected_version: input.expectedVersion && input.expectedVersion > 0 ? input.expectedVersion : null,
  });
  if (!rpc.error) return { ...(rpc.data || {}), restored: true };
  if (!missingCanonicalRpc(rpc.error.message)) throw new Error(rpc.error.message);

  const before = await currentRouteData(input.service, input.companyId, input.route.id);
  const original = normalizeOrder(before.smartState?.original_order || []);
  const restoredOrder = original.filter(id => before.visitIds.includes(id));
  for (const id of before.currentOrder) if (!restoredOrder.includes(id)) restoredOrder.push(id);
  if (!restoredOrder.length) return { restored: false, routeId: input.route.id };

  const result = await directReplaceOrder({
    service: input.service,
    profileId: input.profile.id,
    companyId: input.companyId,
    route: input.route,
    orderedVisitIds: restoredOrder,
    expectedVersion: input.expectedVersion,
    source: "employee_smart_route_restore_global_fallback",
    active: false,
    originalOrder: restoredOrder,
  });
  return { ...result, restored: true };
}

function isRetiredDemoYork(visit: any) {
  const property = joined(visit.properties);
  const customer = joined(visit.customers);
  const address = String(property?.address_line1 || "").trim().toLowerCase().replace(/\./g, "");
  const york = address === "55 york blvd" || address === "55 york boulevard";
  const demo = /^demo customer\b/i.test(String(customer?.full_name || ""))
    || /@4everseasons\.test$/i.test(String(customer?.email || ""))
    || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""));
  return york && demo;
}

async function cleanupDemoYork(input: {
  service: any;
  profile: any;
  companyId: string;
  route: any;
}) {
  if (!["admin", "manager", "master"].includes(String(input.profile.role))) {
    throw new Error("Only Admin can remove temporary demo route data.");
  }

  const result = await input.service
    .from("visits")
    .select("id,job_id,customer_id,property_id,status,route_order,created_at,customers(full_name,email,notes),properties(address_line1)")
    .eq("route_id", input.route.id)
    .neq("status", "cancelled")
    .or(companyFilter(input.companyId))
    .order("route_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (result.error) throw new Error(result.error.message);

  const retired = (result.data || []).filter(isRetiredDemoYork);
  if (!retired.length) return { cleaned: false, removed: 0, routeId: input.route.id };
  if (retired.some((visit: any) => String(visit.status) === "in_progress")) {
    throw new Error("55 York Blvd is currently active and cannot be removed until the service is stopped.");
  }

  const visitIds = retired.map((visit: any) => String(visit.id));
  const jobIds = normalizeOrder(retired.map((visit: any) => String(visit.job_id || "")));
  const customerIds = normalizeOrder(retired.map((visit: any) => String(visit.customer_id || "")));

  const removedStops = await input.service.from("route_stops").delete().in("visit_id", visitIds);
  if (removedStops.error) throw new Error(removedStops.error.message);

  const cancelled = await input.service.from("visits").update({
    status: "cancelled",
    route_id: null,
    route_order: null,
    crew_id: null,
    assigned_employee_id: null,
    started_at: null,
    finished_at: null,
    duration_seconds: null,
  }).in("id", visitIds);
  if (cancelled.error) throw new Error(cancelled.error.message);

  if (jobIds.length) {
    const jobs = await input.service.from("jobs").update({ active: false }).in("id", jobIds);
    if (jobs.error) throw new Error(jobs.error.message);
  }
  if (customerIds.length) {
    const customers = await input.service.from("customers")
      .update({ archived_at: new Date().toISOString() })
      .in("id", customerIds);
    if (customers.error) throw new Error(customers.error.message);
  }

  const remaining = await currentRouteData(input.service, input.companyId, input.route.id);
  const resultOrder = await directReplaceOrder({
    service: input.service,
    profileId: input.profile.id,
    companyId: input.companyId,
    route: input.route,
    orderedVisitIds: remaining.currentOrder,
    source: "remove_retired_demo_york",
    active: false,
    originalOrder: remaining.currentOrder,
  });

  try { await input.service.from("route_map_cache").delete().eq("route_id", input.route.id); } catch { /* optional legacy cache */ }

  return { ...resultOrder, cleaned: true, removed: visitIds.length };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const routeId = String(body.routeId || "").trim();
    if (!routeId) throw new Error("routeId is required.");

    const context = await requireProfile(request);
    const route = await routeAccess(context.service, context.profile, context.companyId, routeId);
    const action = body.action || "apply";

    if (action === "cleanup_demo_york") {
      const cleaned = await cleanupDemoYork({ ...context, route });
      return NextResponse.json(cleaned);
    }
    if (action === "restore") {
      const restored = await restoreOrder({ ...context, route, expectedVersion: body.expectedVersion });
      return NextResponse.json(restored);
    }

    const orderedVisitIds = normalizeOrder(body.orderedVisitIds);
    if (!orderedVisitIds.length) throw new Error("Keep at least one house in the route.");
    const applied = await applyOrder({
      ...context,
      route,
      orderedVisitIds,
      origin: body.origin,
      expectedVersion: body.expectedVersion,
    });
    return NextResponse.json(applied);
  } catch (error) {
    console.error("canonical-route-order", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route order could not be saved." },
      { status: 400 },
    );
  }
}
