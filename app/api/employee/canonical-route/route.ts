import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const uncachedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  cache: "no-store",
});

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Employee canonical route resolver is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: uncachedFetch },
  }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function noRoute(message: string) {
  return NextResponse.json(
    { error: message, code: "NO_ROUTE" },
    { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date")?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid route date is required.");

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sign in to view this route.");

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
    if (!profile?.active || String(profile.role) !== "employee") throw new Error("An active Employee account is required.");
    const companyId = String(profile.company_id || profile.organization_id || "");
    if (!companyId) throw new Error("This Employee is not linked to a company.");

    const employeesResult = await service
      .from("employees")
      .select("id,crew_id,created_at")
      .eq("profile_id", profile.id)
      .eq("active", true)
      .or(companyFilter(companyId));
    if (employeesResult.error) throw new Error(employeesResult.error.message);
    const employees = employeesResult.data || [];
    if (!employees.length) throw new Error("No active Employee is linked to this login.");

    const employeeIds = employees.map((row: any) => String(row.id));
    const crewIds = [...new Set<string>(employees.map((row: any) => String(row.crew_id || "")).filter(Boolean))];

    // Visits assigned to this Employee on this date are authoritative.
    // Crew routes are only a fallback for legacy rows with no direct assignment.
    const assignedResult = await service
      .from("visits")
      .select("route_id,assigned_employee_id")
      .eq("scheduled_date", date)
      .in("assigned_employee_id", employeeIds)
      .neq("status", "cancelled")
      .or(companyFilter(companyId));
    if (assignedResult.error) throw new Error(assignedResult.error.message);

    const directlyAssignedRouteIds = [...new Set<string>(
      (assignedResult.data || []).map((row: any) => String(row.route_id || "")).filter(Boolean),
    )];

    let ids = directlyAssignedRouteIds;
    let resolutionSource: "assigned_visits" | "crew_fallback" = "assigned_visits";

    if (!ids.length && crewIds.length) {
      const crewRoutes = await service
        .from("routes")
        .select("id")
        .eq("route_date", date)
        .in("crew_id", crewIds)
        .or(companyFilter(companyId));
      if (crewRoutes.error) throw new Error(crewRoutes.error.message);
      ids = [...new Set<string>((crewRoutes.data || []).map((row: any) => String(row.id)).filter(Boolean))];
      resolutionSource = "crew_fallback";
    }

    if (!ids.length) return noRoute("No route is assigned for this date.");

    const [routesResult, statesResult, visitsResult, stopsResult] = await Promise.all([
      service.from("routes").select("id,created_at").in("id", ids).or(companyFilter(companyId)),
      service.from("route_order_state").select("route_id,version,updated_at").in("route_id", ids),
      service.from("visits").select("route_id,id").in("route_id", ids).neq("status", "cancelled").or(companyFilter(companyId)),
      service.from("route_stops").select("route_id,visit_id,position").in("route_id", ids),
    ]);
    if (routesResult.error) throw new Error(routesResult.error.message);
    if (statesResult.error) throw new Error(statesResult.error.message);
    if (visitsResult.error) throw new Error(visitsResult.error.message);
    if (stopsResult.error) throw new Error(stopsResult.error.message);

    const stateByRoute = new Map((statesResult.data || []).map((row: any) => [String(row.route_id), row]));
    const visitCountByRoute = new Map<string, number>();
    const stopCountByRoute = new Map<string, number>();

    for (const row of visitsResult.data || []) {
      const routeId = String(row.route_id || "");
      if (routeId) visitCountByRoute.set(routeId, (visitCountByRoute.get(routeId) || 0) + 1);
    }
    for (const row of stopsResult.data || []) {
      const routeId = String(row.route_id || "");
      if (routeId) stopCountByRoute.set(routeId, (stopCountByRoute.get(routeId) || 0) + 1);
    }

    const candidates = (routesResult.data || []).map((route: any) => {
      const routeId = String(route.id);
      const state: any = stateByRoute.get(routeId);
      const visitCount = visitCountByRoute.get(routeId) || 0;
      const stopCount = stopCountByRoute.get(routeId) || 0;
      return {
        routeId,
        routeVersion: Number(state?.version || 0),
        updatedAt: String(state?.updated_at || route.created_at || ""),
        visitCount,
        stopCount,
        canonicalComplete: visitCount > 0 && stopCount === visitCount,
      };
    }).filter((candidate: any) => candidate.visitCount > 0);

    candidates.sort((left: any, right: any) =>
      Number(right.canonicalComplete) - Number(left.canonicalComplete)
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.routeVersion - left.routeVersion
      || right.visitCount - left.visitCount
      || left.stopCount - right.stopCount
      || left.routeId.localeCompare(right.routeId),
    );

    const selected = candidates[0];
    if (!selected) return noRoute("No active canonical route remains for this date.");

    console.info("employee-canonical-route-resolved", {
      date,
      resolutionSource,
      selectedRouteId: selected.routeId,
      selectedRouteVersion: selected.routeVersion,
      candidates,
    });

    return NextResponse.json({
      routeId: selected.routeId,
      routeVersion: selected.routeVersion,
      updatedAt: selected.updatedAt,
      stopCount: selected.stopCount,
      resolutionSource,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("employee-canonical-route-resolver", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Employee canonical route could not be resolved." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
