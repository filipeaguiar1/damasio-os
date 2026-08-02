import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RouteOrigin = {
  label?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type RequestBody = {
  action?: "apply" | "restore";
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

function normalizeOrder(values?: string[]) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every(value => expected.has(value));
}

function missingWrapper(message?: string) {
  return /apply_canonical_route_order_v2|restore_canonical_route_order_v2|schema cache|could not find the function/i.test(message || "");
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

async function requireRouteAccess(service: any, profile: any, companyId: string, routeId: string) {
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

    const assigned = await service
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId)
      .eq("assigned_employee_id", employee.id)
      .neq("status", "cancelled");
    if (assigned.error) throw new Error(assigned.error.message);
    if (route.crew_id !== employee.crew_id && !assigned.count) {
      throw new Error("This route is not assigned to the authenticated Employee.");
    }
  } else if (!["admin", "manager", "master"].includes(String(profile.role))) {
    throw new Error("This account cannot change operational routes.");
  }

  return route;
}

async function currentRouteData(service: any, companyId: string, routeId: string) {
  const [visitsResult, stopsResult, versionResult, smartResult] = await Promise.all([
    service.from("visits")
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
  const activeIds = new Set(visitIds);
  const stopOrder = stopsResult.error
    ? []
    : normalizeOrder((stopsResult.data || [])
      .map((row: any) => String(row.visit_id))
      .filter((visitId: string) => activeIds.has(visitId)));
  const currentOrder = sameMembers(visitIds, stopOrder) ? stopOrder : visitIds;

  return {
    visits,
    visitIds,
    currentOrder,
    version: Number(versionResult.error ? 1 : versionResult.data?.version || 1),
    smartState: smartResult.error ? null : smartResult.data,
  };
}

async function replaceCanonicalOrder(input: {
  service: any;
  profileId: string;
  routeId: string;
  orderedVisitIds: string[];
  expectedVersion?: number | null;
  source: string;
}) {
  const replaced = await input.service.rpc("replace_canonical_route_order_v2", {
    p_route_id: input.routeId,
    p_ordered_visit_ids: input.orderedVisitIds,
    p_source: input.source,
    p_actor_profile_id: input.profileId,
    p_expected_version: input.expectedVersion && input.expectedVersion > 0 ? input.expectedVersion : null,
    p_allow_empty: false,
  });
  if (replaced.error) throw new Error(replaced.error.message);
  return Number(replaced.data?.version || 0);
}

async function saveSmartState(input: {
  service: any;
  profileId: string;
  companyId: string;
  route: any;
  order: string[];
  originalOrder: string[];
  origin?: RouteOrigin | null;
  version: number;
  active: boolean;
  previousState?: any;
}) {
  const previous = input.previousState || null;
  const now = new Date().toISOString();
  const result = await input.service.from("employee_smart_route_state").upsert({
    company_id: input.companyId,
    route_id: input.route.id,
    crew_id: input.route.crew_id,
    route_date: input.route.route_date,
    original_order: input.originalOrder,
    applied_order: input.order,
    origin_label: input.origin?.label || previous?.origin_label || "",
    origin_latitude: Number.isFinite(input.origin?.latitude)
      ? Number(input.origin?.latitude)
      : previous?.origin_latitude ?? null,
    origin_longitude: Number.isFinite(input.origin?.longitude)
      ? Number(input.origin?.longitude)
      : previous?.origin_longitude ?? null,
    active: input.active,
    applied_by_profile_id: input.active ? input.profileId : previous?.applied_by_profile_id || input.profileId,
    applied_at: input.active ? now : previous?.applied_at || now,
    restored_at: input.active ? null : now,
    restored_by_profile_id: input.active ? null : input.profileId,
    route_version: input.version,
    updated_at: now,
  }, { onConflict: "route_id" });
  if (result.error) throw new Error(result.error.message);
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
  const before = await currentRouteData(input.service, input.companyId, input.route.id);
  if (!sameMembers(before.visitIds, input.orderedVisitIds)) {
    throw new Error("The reviewed route must contain every active house exactly once.");
  }
  if (before.visits.some((visit: any) => String(visit.status) === "in_progress")) {
    throw new Error("Finish the active house before changing this route.");
  }

  const wrapped = await input.user.rpc("apply_canonical_route_order_v2", {
    p_route_id: input.route.id,
    p_ordered_visit_ids: input.orderedVisitIds,
    p_origin_label: input.origin?.label || "",
    p_origin_latitude: Number.isFinite(input.origin?.latitude) ? Number(input.origin?.latitude) : null,
    p_origin_longitude: Number.isFinite(input.origin?.longitude) ? Number(input.origin?.longitude) : null,
    p_expected_version: input.expectedVersion && input.expectedVersion > 0 ? input.expectedVersion : null,
    p_source: "employee_smart_route_global",
  });

  if (!wrapped.error) {
    const result = wrapped.data || {};
    return {
      saved: true,
      routeId: input.route.id,
      version: Number(result.version || result.routeVersion || 0),
      appliedOrder: result.appliedOrder || input.orderedVisitIds,
      active: true,
    };
  }
  if (!missingWrapper(wrapped.error.message)) throw new Error(wrapped.error.message);

  const version = await replaceCanonicalOrder({
    service: input.service,
    profileId: input.profile.id,
    routeId: input.route.id,
    orderedVisitIds: input.orderedVisitIds,
    expectedVersion: input.expectedVersion,
    source: "employee_smart_route_global_fallback",
  });
  const previousOriginal = Array.isArray(before.smartState?.original_order)
    ? before.smartState.original_order.map(String)
    : [];
  const originalOrder = before.smartState?.active && previousOriginal.length
    ? previousOriginal
    : before.currentOrder;

  await saveSmartState({
    service: input.service,
    profileId: input.profile.id,
    companyId: input.companyId,
    route: input.route,
    order: input.orderedVisitIds,
    originalOrder,
    origin: input.origin,
    version,
    active: true,
    previousState: before.smartState,
  });

  const verified = await currentRouteData(input.service, input.companyId, input.route.id);
  if (verified.currentOrder.join("|") !== input.orderedVisitIds.join("|")) {
    throw new Error("Canonical route verification failed.");
  }
  return { saved: true, routeId: input.route.id, version, appliedOrder: input.orderedVisitIds, active: true };
}

async function restoreOrder(input: {
  service: any;
  user: any;
  profile: any;
  companyId: string;
  route: any;
  expectedVersion?: number | null;
}) {
  const wrapped = await input.user.rpc("restore_canonical_route_order_v2", {
    p_route_id: input.route.id,
    p_expected_version: input.expectedVersion && input.expectedVersion > 0 ? input.expectedVersion : null,
  });
  if (!wrapped.error) return { ...(wrapped.data || {}), restored: true };
  if (!missingWrapper(wrapped.error.message)) throw new Error(wrapped.error.message);

  const before = await currentRouteData(input.service, input.companyId, input.route.id);
  const original = normalizeOrder(before.smartState?.original_order || []);
  const restoredOrder = original.filter(visitId => before.visitIds.includes(visitId));
  for (const visitId of before.currentOrder) if (!restoredOrder.includes(visitId)) restoredOrder.push(visitId);
  if (!restoredOrder.length) return { restored: false, routeId: input.route.id };

  const version = await replaceCanonicalOrder({
    service: input.service,
    profileId: input.profile.id,
    routeId: input.route.id,
    orderedVisitIds: restoredOrder,
    expectedVersion: input.expectedVersion,
    source: "employee_smart_route_restore_global_fallback",
  });
  await saveSmartState({
    service: input.service,
    profileId: input.profile.id,
    companyId: input.companyId,
    route: input.route,
    order: restoredOrder,
    originalOrder: restoredOrder,
    version,
    active: false,
    previousState: before.smartState,
  });

  const verified = await currentRouteData(input.service, input.companyId, input.route.id);
  if (verified.currentOrder.join("|") !== restoredOrder.join("|")) {
    throw new Error("Canonical route verification failed.");
  }
  return { restored: true, routeId: input.route.id, version, appliedOrder: restoredOrder, active: false };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const routeId = String(body.routeId || "").trim();
    if (!routeId) throw new Error("routeId is required.");

    const context = await requireProfile(request);
    const route = await requireRouteAccess(context.service, context.profile, context.companyId, routeId);
    if (body.action === "restore") {
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
