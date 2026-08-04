import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Employee canonical route resolver is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
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

    const assignedResult = await service
      .from("visits")
      .select("route_id")
      .eq("scheduled_date", date)
      .in("assigned_employee_id", employeeIds)
      .neq("status", "cancelled")
      .or(companyFilter(companyId));
    if (assignedResult.error) throw new Error(assignedResult.error.message);

    const routeIds = new Set<string>(
      (assignedResult.data || []).map((row: any) => String(row.route_id || "")).filter(Boolean),
    );

    if (crewIds.length) {
      const crewRoutes = await service
        .from("routes")
        .select("id")
        .eq("route_date", date)
        .in("crew_id", crewIds)
        .or(companyFilter(companyId));
      if (crewRoutes.error) throw new Error(crewRoutes.error.message);
      for (const row of crewRoutes.data || []) routeIds.add(String(row.id));
    }

    if (!routeIds.size) throw new Error("No route is assigned for this date.");
    const ids = [...routeIds];

    const [routesResult, statesResult, visitsResult] = await Promise.all([
      service.from("routes").select("id,created_at").in("id", ids).or(companyFilter(companyId)),
      service.from("route_order_state").select("route_id,version,updated_at").in("route_id", ids),
      service.from("visits").select("route_id,id").in("route_id", ids).neq("status", "cancelled").or(companyFilter(companyId)),
      service.from("route_stops").select("route_id,visit_id,position").in("route_id", ids),
    ]);
    if (routesResult.error) throw new Error(routesResult.error.message);
    if (statesResult.error) throw new Error(statesResult.error.message);
    if (visitsResult.error) throw new Error(visitsResult.error.message);

    const stateByRoute = new Map((statesResult.data || []).map((row: any) => [String(row.route_id), row]));
    const countByRoute = new Map<string, number>();
    for (const row of visitsResult.data || []) {
      const id = String(row.route_id || "");
      if (id) countByRoute.set(id, (countByRoute.get(id) || 0) + 1);
    }

    const candidates = (routesResult.data || []).map((route: any) => {
      const state: any = stateByRoute.get(String(route.id));
      return {
        routeId: String(route.id),
        routeVersion: Number(state?.version || 0),
        updatedAt: String(state?.updated_at || route.created_at || ""),
        stopCount: countByRoute.get(String(route.id)) || 0,
      };
    }).filter((candidate: any) => candidate.stopCount > 0);

    candidates.sort((left: any, right: any) =>
      right.routeVersion - left.routeVersion
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.stopCount - right.stopCount
      || left.routeId.localeCompare(right.routeId),
    );

    const selected = candidates[0];
    if (!selected) throw new Error("No active canonical route remains for this date.");

    return NextResponse.json(selected, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Employee canonical route could not be resolved." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
