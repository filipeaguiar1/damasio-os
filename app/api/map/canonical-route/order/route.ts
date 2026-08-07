import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyCanonicalRoutePersistence } from "@/lib/routes/verifyCanonicalRoutePersistence";

export const dynamic = "force-dynamic";

type RequestBody = {
  action?: "apply" | "restore";
  routeId?: string;
  orderedVisitIds?: string[];
  origin?: {
    label?: string;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  expectedVersion?: number | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical route writer is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
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
  return (values || []).map(String).filter(Boolean);
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function migrationError(message?: string) {
  if (/apply_canonical_route_order_v2_service|restore_canonical_route_order_v2|schema cache|could not find the function/i.test(message || "")) {
    return new Error("Canonical Route Stops V2 service contract is not installed. The route was not changed.");
  }
  return new Error(message || "Canonical route order could not be saved.");
}

function projectionError(message?: string) {
  if (/sync_canonical_route_stops_v2|schema cache|could not find the function|permission denied/i.test(message || "")) {
    return new Error("Canonical Route one-way Visit projection is not installed for the service writer.");
  }
  return new Error(message || "Canonical Route Visit projection could not be synchronized.");
}

async function projectCanonicalVisitOrder(service: any, routeId: string, source: string) {
  const projection = await service.rpc("sync_canonical_route_stops_v2", {
    p_route_id: routeId,
    p_source: source,
  });
  if (projection.error) throw projectionError(projection.error.message);
  return projection.data || {};
}

async function requireContext(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to change this route.");

  const service = serviceClient();
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

  return {
    service,
    user: userClient(token),
    profile,
    companyId: String(companyId),
  };
}

async function requireRouteAccess(context: Awaited<ReturnType<typeof requireContext>>, routeId: string) {
  const routeResult = await context.service
    .from("routes")
    .select("id,crew_id,company_id,organization_id")
    .eq("id", routeId)
    .maybeSingle();
  if (routeResult.error) throw new Error(routeResult.error.message);
  const route = routeResult.data;
  if (!route || String(route.company_id || route.organization_id) !== context.companyId) {
    throw new Error("Route not found in this company.");
  }

  if (String(context.profile.role) === "employee") {
    const employeeResult = await context.service
      .from("employees")
      .select("id,crew_id,active")
      .eq("profile_id", context.profile.id)
      .eq("active", true)
      .or(companyFilter(context.companyId))
      .maybeSingle();
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    const employee = employeeResult.data;
    if (!employee) throw new Error("No active Employee is linked to this login.");

    const assigned = await context.service
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId)
      .eq("assigned_employee_id", employee.id)
      .neq("status", "cancelled");
    if (assigned.error) throw new Error(assigned.error.message);
    if (route.crew_id !== employee.crew_id && !assigned.count) {
      throw new Error("This Route is not assigned to the authenticated Employee.");
    }
  } else if (!["admin", "manager", "master"].includes(String(context.profile.role))) {
    throw new Error("This account cannot change operational routes.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const routeId = String(body.routeId || "").trim();
    if (!routeId) throw new Error("routeId is required.");

    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("A reviewed routeVersion is required before saving.");
    }

    const context = await requireContext(request);
    await requireRouteAccess(context, routeId);

    if (body.action === "restore") {
      const restored = await context.user.rpc("restore_canonical_route_order_v2", {
        p_route_id: routeId,
        p_expected_version: expectedVersion,
      });
      if (restored.error) throw migrationError(restored.error.message);
      const result = restored.data || {};
      await projectCanonicalVisitOrder(context.service, routeId, "canonical_restore_projection");
      return NextResponse.json({
        ...result,
        routeId,
        routeVersion: Number(result.version || result.routeVersion || 0),
        restored: Boolean(result.restored),
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const orderedVisitIds = normalizeOrder(body.orderedVisitIds);
    if (!orderedVisitIds.length) throw new Error("Keep at least one house in the Route.");
    if (new Set(orderedVisitIds).size !== orderedVisitIds.length) {
      throw new Error("The reviewed Route contains duplicate houses.");
    }

    const latitude = Number(body.origin?.latitude);
    const longitude = Number(body.origin?.longitude);
    const originLabel = String(body.origin?.label || "Route start");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("A valid canonical Route origin is required.");
    }

    console.info("canonical-route-order-request", {
      routeId,
      expectedVersion,
      orderedVisitIds,
      origin: { label: originLabel, latitude, longitude },
      actorRole: String(context.profile.role),
    });

    const applied = await context.service.rpc("apply_canonical_route_order_v2_service", {
      p_route_id: routeId,
      p_ordered_visit_ids: orderedVisitIds,
      p_origin_label: originLabel,
      p_origin_latitude: latitude,
      p_origin_longitude: longitude,
      p_expected_version: expectedVersion,
      p_actor_profile_id: context.profile.id,
      p_source: ["admin", "manager", "master"].includes(String(context.profile.role))
        ? "admin_canonical_route"
        : "employee_smart_route_global",
    });
    if (applied.error) throw migrationError(applied.error.message);

    const result = applied.data || {};
    const savedOrder = Array.isArray(result.appliedOrder)
      ? result.appliedOrder.map(String)
      : Array.isArray(result.applied_order)
        ? result.applied_order.map(String)
        : [];
    const routeVersion = Number(result.version || result.routeVersion || 0);
    if (!sameOrder(savedOrder, orderedVisitIds) || !Number.isInteger(routeVersion) || routeVersion < 1) {
      throw new Error("The database did not confirm the exact canonical order and version.");
    }

    // route_stops is the only durable order. Some deployed databases still lack
    // the newer route_stops trigger, so explicitly run the existing one-way
    // compatibility projection before persistence verification. This never writes
    // back to route_stops and prevents a successful canonical save from being
    // reported as failed only because visits.route_order is stale.
    await projectCanonicalVisitOrder(context.service, routeId, "canonical_apply_projection_api");

    const verified = await verifyCanonicalRoutePersistence(context.service, {
      routeId,
      orderedVisitIds,
      routeVersion,
      origin: { label: originLabel, latitude, longitude },
    });

    console.info("canonical-route-order-persisted", {
      routeId,
      expectedVersion,
      routeVersion: verified.routeVersion,
      orderedVisitIds: verified.orderedVisitIds,
      origin: verified.origin,
    });

    return NextResponse.json({
      saved: true,
      routeId,
      routeVersion: verified.routeVersion,
      version: verified.routeVersion,
      appliedOrder: verified.orderedVisitIds,
      orderedVisitIds: verified.orderedVisitIds,
      origin: verified.origin,
      count: verified.orderedVisitIds.length,
      active: true,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("canonical-route-order", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route order could not be saved." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
