import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Admin canonical route resolver is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date")?.trim();
    const profileId = request.nextUrl.searchParams.get("profileId")?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid route date is required.");
    if (!profileId) throw new Error("An Employee profile is required.");

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sign in as the company Admin.");

    const service = serviceClient();
    const auth = await service.auth.getUser(token);
    if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

    const adminResult = await service
      .from("profiles")
      .select("id,role,active,company_id,organization_id")
      .eq("id", auth.data.user.id)
      .maybeSingle();
    if (adminResult.error) throw new Error(adminResult.error.message);
    const admin = adminResult.data;
    if (!admin?.active || !["admin", "manager", "master"].includes(String(admin.role))) {
      throw new Error("Only an active company Admin can resolve Employee routes.");
    }
    const companyId = String(admin.company_id || admin.organization_id || "");
    if (!companyId) throw new Error("This Admin is not linked to a company.");

    const employeeProfile = await service
      .from("profiles")
      .select("id,role,active,company_id,organization_id")
      .eq("id", profileId)
      .maybeSingle();
    if (employeeProfile.error) throw new Error(employeeProfile.error.message);
    const target = employeeProfile.data;
    if (!target?.active || String(target.role) !== "employee"
      || String(target.company_id || target.organization_id || "") !== companyId) {
      throw new Error("The selected Employee is not active in this company.");
    }

    const employeesResult = await service
      .from("employees")
      .select("id,crew_id")
      .eq("profile_id", profileId)
      .eq("active", true)
      .or(companyFilter(companyId));
    if (employeesResult.error) throw new Error(employeesResult.error.message);
    const employees = employeesResult.data || [];
    if (!employees.length) throw new Error("No active Employee row is linked to this profile.");

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

    if (!routeIds.size) throw new Error("No route is assigned for this Employee and date.");
    const ids = [...routeIds];

    const [routesResult, statesResult, stopsResult, visitsResult] = await Promise.all([
      service.from("routes").select("id,created_at").in("id", ids).or(companyFilter(companyId)),
      service.from("route_order_state").select("route_id,version,updated_at").in("route_id", ids),
      service.from("route_stops").select("route_id,visit_id,position").in("route_id", ids),
      service.from("visits").select("route_id,id,status").in("route_id", ids).neq("status", "cancelled").or(companyFilter(companyId)),
    ]);
    if (routesResult.error) throw new Error(routesResult.error.message);
    if (statesResult.error) throw new Error(statesResult.error.message);
    if (stopsResult.error) throw new Error(stopsResult.error.message);
    if (visitsResult.error) throw new Error(visitsResult.error.message);

    const stateByRoute = new Map((statesResult.data || []).map((row: any) => [String(row.route_id), row]));
    const visitsByRoute = new Map<string, Set<string>>();
    for (const row of visitsResult.data || []) {
      const routeId = String(row.route_id || "");
      if (!routeId) continue;
      const values = visitsByRoute.get(routeId) || new Set<string>();
      values.add(String(row.id));
      visitsByRoute.set(routeId, values);
    }
    const stopsByRoute = new Map<string, Array<{ visitId: string; position: number }>>();
    for (const row of stopsResult.data || []) {
      const routeId = String(row.route_id || "");
      if (!routeId) continue;
      const values = stopsByRoute.get(routeId) || [];
      values.push({ visitId: String(row.visit_id), position: Number(row.position) });
      stopsByRoute.set(routeId, values);
    }

    const candidates = (routesResult.data || []).flatMap((route: any) => {
      const routeId = String(route.id);
      const visits = visitsByRoute.get(routeId) || new Set<string>();
      const stops = (stopsByRoute.get(routeId) || []).sort((a, b) => a.position - b.position);
      const valid = visits.size > 0
        && stops.length === visits.size
        && stops.every((stop, index) => stop.position === index + 1 && visits.has(stop.visitId));
      if (!valid) return [];
      const state: any = stateByRoute.get(routeId);
      return [{
        routeId,
        routeVersion: Number(state?.version || 0),
        updatedAt: String(state?.updated_at || route.created_at || ""),
        stopCount: stops.length,
      }];
    });

    candidates.sort((left: any, right: any) =>
      right.routeVersion - left.routeVersion
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.stopCount - right.stopCount
      || left.routeId.localeCompare(right.routeId),
    );

    const selected = candidates[0];
    if (!selected) throw new Error("No valid canonical Route remains for this Employee and date.");

    return NextResponse.json(selected, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Admin canonical route could not be resolved." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
