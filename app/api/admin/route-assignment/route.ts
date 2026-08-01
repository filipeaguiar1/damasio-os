import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceMovedVisitEmployee, requireCanonicalRouteEmployee } from "@/lib/routes/routeAssignmentIntegrity";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route assignment is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser access is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");

  const { data: profile, error } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can change assignments.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");

  return { service, user: userClient(token), companyId: String(companyId) };
}

function assignmentError(message?: string) {
  const value = message || "Canonical assignment failed.";
  if (/move_canonical_visits|schema cache|could not find the function/i.test(value)) {
    return new Error("Supabase migration 202607280001_route_assignment_modes.sql is pending.");
  }
  return new Error(value);
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const body = await request.json() as {
      mode?: "temporary" | "permanent";
      visitIds?: string[];
      employeeId?: string;
      crewId?: string;
    };

    const mode = body.mode === "permanent" ? "permanent" : "temporary";
    const visitIds = [...new Set((body.visitIds || []).map(String).filter(Boolean))];
    const employeeId = String(body.employeeId || "");
    const crewId = String(body.crewId || "");

    if (!visitIds.length) throw new Error("Select at least one scheduled Visit.");
    if (!employeeId || !crewId) throw new Error("Choose the destination Employee.");

    await requireCanonicalRouteEmployee({ service, companyId, employeeId, crewId });

    const result = await user.rpc("move_canonical_visits", {
      p_visit_ids: visitIds,
      p_employee_id: employeeId,
      p_crew_id: crewId,
      p_mode: mode,
    });

    if (result.error) throw assignmentError(result.error.message);

    const movedIds = [...new Set([
      ...visitIds,
      ...((result.data?.visitIds || result.data?.movedVisitIds || []) as unknown[]).map(String).filter(Boolean),
    ])];
    const verified = await enforceMovedVisitEmployee({
      service,
      companyId,
      employeeId,
      crewId,
      visitIds: movedIds,
    });

    console.info("admin-route-move-verified", {
      companyId,
      mode,
      employeeId: verified.employeeId,
      visitIds: movedIds,
      movedCount: verified.movedCount,
    });

    return NextResponse.json({
      ...(result.data || {}),
      ...verified,
      selectedCount: visitIds.length,
      movedCount: movedIds.length,
      assignmentVerified: true,
    });
  } catch (error) {
    console.error("admin-route-assignment-post", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Route assignment failed." },
      { status: 400 },
    );
  }
}
