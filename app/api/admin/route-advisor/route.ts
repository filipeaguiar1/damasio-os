import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    return new Error("Supabase migration 202607280001_route_assignment_modes.sql is pending.");
  }
  if (/reopen_completed_visit/i.test(value)) {
    return new Error("Supabase migration 202607270003_completed_visit_reopen_guard.sql is pending or not confirmed.");
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

  return { service, user: userClient(token), companyId };
}

async function sourceVisitIdsForMove(
  service: any,
  companyId: string,
  input?: {
    employeeId?: string;
    crewId?: string;
    routeDate?: string;
    jobIds?: string[];
  },
) {
  const jobIds = [...new Set((input?.jobIds || []).map(String).filter(Boolean))];
  if (!input?.routeDate || !jobIds.length) return [] as string[];

  let query = service
    .from("visits")
    .select("id,job_id,status,assigned_employee_id,crew_id,scheduled_date")
    .eq("scheduled_date", input.routeDate)
    .in("job_id", jobIds)
    .neq("status", "cancelled")
    .or(companyFilter(companyId));

  if (input.employeeId && input.crewId) {
    query = query.or(`assigned_employee_id.eq.${input.employeeId},crew_id.eq.${input.crewId}`);
  } else if (input.employeeId) {
    query = query.eq("assigned_employee_id", input.employeeId);
  } else if (input.crewId) {
    query = query.eq("crew_id", input.crewId);
  }

  const result = await query;
  if (result.error) throw new Error(result.error.message);

  const rows = result.data || [];
  if (rows.some((visit: any) => ["completed", "in_progress"].includes(visit.status))) {
    throw new Error("Completed or active Visits cannot be moved.");
  }

  const byJob = new Map<string, any[]>();
  for (const visit of rows) {
    const current = byJob.get(visit.job_id) || [];
    current.push(visit);
    byJob.set(visit.job_id, current);
  }

  for (const jobId of jobIds) {
    const matches = byJob.get(jobId) || [];
    if (matches.length !== 1) {
      throw new Error(`Move requires exactly one canonical Visit for Job ${jobId} on ${input.routeDate}.`);
    }
  }

  return jobIds.map(jobId => byJob.get(jobId)![0].id as string);
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
      removeFrom?: {
        employeeId?: string;
        crewId?: string;
        routeDate?: string;
        jobIds?: string[];
      };
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
    if (!orderedJobIds.length) throw new Error("Keep at least one house in the route preview.");

    const moveSourceIds = await sourceVisitIdsForMove(service, companyId, body.removeFrom);
    const sourceVisitIds = [...new Set([
      ...(body.sourceVisitIds || []).map(String).filter(Boolean),
      ...moveSourceIds,
    ])];

    if (sourceVisitIds.length) {
      const sourceCheck = await service
        .from("visits")
        .select("id,status,job_id")
        .in("id", sourceVisitIds)
        .or(companyFilter(companyId));
      if (sourceCheck.error) throw new Error(sourceCheck.error.message);
      if ((sourceCheck.data || []).length !== sourceVisitIds.length) {
        throw new Error("One or more source Visits are not canonical for this company.");
      }
      if ((sourceCheck.data || []).some((visit: any) => !["scheduled", "missed"].includes(visit.status))) {
        throw new Error("Only Scheduled or Needs Reschedule Visits can be moved.");
      }
    }

    const result = await user.rpc("publish_canonical_route_daily", {
      p_employee_id: employeeId,
      p_crew_id: crewId,
      p_route_date: routeDate,
      p_ordered_job_ids: orderedJobIds,
      p_source_visit_ids: sourceVisitIds,
    });

    if (result.error) throw rpcError(result.error.message);
    return NextResponse.json(result.data);
  } catch (error) {
    console.error("admin-route-advisor-post", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Route Advisor request failed." },
      { status: 400 },
    );
  }
}
