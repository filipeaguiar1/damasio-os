import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforcePublishedRouteEmployee, requireCanonicalRouteEmployee } from "@/lib/routes/routeAssignmentIntegrity";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route Advisor is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
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

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function rpcError(message?: string) {
  const value = message || "Canonical route operation failed.";
  if (/publish_canonical_route_daily|schema cache|could not find the function/i.test(value)) {
    return new Error("The canonical daily-route database function is unavailable.");
  }
  if (/reopen_completed_visit/i.test(value)) {
    return new Error("The completed Visit reopen function is unavailable.");
  }
  return new Error(value);
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
    throw new Error("Only an active company Admin can publish or reopen Visits.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, user: userClient(token), companyId: String(companyId) };
}

async function requirePermanentOwnership(input: {
  service: any;
  companyId: string;
  crewId: string;
  jobIds: string[];
}) {
  const { service, companyId, crewId, jobIds } = input;
  const result = await service
    .from("jobs")
    .select("id,default_crew_id,active")
    .in("id", jobIds)
    .eq("active", true)
    .or(companyFilter(companyId));
  if (result.error) throw new Error(result.error.message);

  const rows = result.data || [];
  if (rows.length !== jobIds.length) {
    throw new Error("One or more selected houses are not active Jobs in this company.");
  }

  const invalid = rows.filter((job: any) => job.default_crew_id !== crewId);
  if (invalid.length) {
    throw new Error(`${invalid.length} selected house${invalid.length === 1 ? " is" : "s are"} not permanently assigned to this Employee. Return to Build.`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const body = await request.json() as {
      action?: "publish" | "reopen";
      employeeId?: string;
      crewId?: string;
      routeDate?: string;
      orderedJobIds?: string[];
      sourceVisitIds?: string[];
      visitId?: string;
      reopenReason?: string;
      confirmReopen?: boolean;
    };

    if (body.action === "reopen") {
      const visitId = String(body.visitId || "");
      const reason = String(body.reopenReason || "").trim();
      if (!body.confirmReopen) throw new Error("Confirm the completed Visit Reopen.");
      if (!visitId) throw new Error("Choose the completed Visit.");
      if (reason.length < 5) throw new Error("A Reopen reason with at least 5 characters is required.");

      const reopened = await user.rpc("reopen_completed_visit", {
        p_visit_id: visitId,
        p_reason: reason,
      });
      if (reopened.error) throw rpcError(reopened.error.message);
      return NextResponse.json({ reopened: true, visit: reopened.data });
    }

    const employeeId = String(body.employeeId || "");
    const crewId = String(body.crewId || "");
    const routeDate = String(body.routeDate || "");
    const orderedJobIds = [...new Set((body.orderedJobIds || []).map(String).filter(Boolean))];

    if (!employeeId || !crewId) throw new Error("Choose a canonical Employee and Crew.");
    if (!routeDate) throw new Error("Choose a route date.");
    if (!orderedJobIds.length) throw new Error("Keep at least one house in the route.");

    await requireCanonicalRouteEmployee({ service, companyId, employeeId, crewId });
    await requirePermanentOwnership({ service, companyId, crewId, jobIds: orderedJobIds });

    const result = await user.rpc("publish_canonical_route_daily", {
      p_employee_id: employeeId,
      p_crew_id: crewId,
      p_route_date: routeDate,
      p_ordered_job_ids: orderedJobIds,
      p_source_visit_ids: [...new Set((body.sourceVisitIds || []).map(String).filter(Boolean))],
    });
    if (result.error) throw rpcError(result.error.message);

    const verified = await enforcePublishedRouteEmployee({
      service,
      companyId,
      employeeId,
      crewId,
      routeDate,
      orderedJobIds,
      preferredRouteId: result.data?.routeId || null,
    });

    if (verified.count !== orderedJobIds.length || verified.employeeId !== employeeId) {
      throw new Error("The published route did not match the selected Employee and was rejected.");
    }

    console.info("admin-route-owner-published", {
      companyId,
      employeeId,
      crewId,
      routeDate,
      routeId: verified.routeId,
      count: verified.count,
      jobIds: orderedJobIds,
    });

    return NextResponse.json({
      ...(result.data || {}),
      ...verified,
      count: orderedJobIds.length,
      assignmentVerified: true,
      permanentOwnershipVerified: true,
    });
  } catch (error) {
    console.error("admin-route-advisor-post", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Route Advisor request failed." },
      { status: 400 },
    );
  }
}
