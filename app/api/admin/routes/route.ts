import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function baseClient(token?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route administration is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const authClient = baseClient();
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await authClient.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active company Admin can manage routes.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { client: baseClient(token), companyId };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Route request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { client, companyId } = await requireAdmin(request);
    const [{ data: board, error: boardError }, { data: jobs, error: jobsError }, { data: employees, error: employeeError }] = await Promise.all([
      client.rpc("get_scheduling_dispatch_board"),
      client.rpc("get_company_dispatch_jobs"),
      client.from("employees").select("id,profile_id,crew_id,full_name,email,route_start_address,address_line1,active").eq("company_id", companyId).eq("active", true).order("full_name"),
    ]);
    if (boardError) throw new Error(boardError.message);
    if (jobsError) throw new Error(jobsError.message);
    if (employeeError) throw new Error(employeeError.message);
    const normalizedBoard = board && typeof board === "object" ? board : {};
    const jobRows = Array.isArray(jobs) ? jobs : [];
    return NextResponse.json({
      employees: (employees || []).filter((item: any) => item.crew_id).map((item: any) => ({
        id: item.profile_id || item.id,
        employeeId: item.id,
        crewId: item.crew_id,
        name: item.full_name,
        email: item.email || "",
        routeStartAddress: item.route_start_address || item.address_line1 || null,
      })),
      board: {
        ...normalizedBoard,
        unscheduledJobs: jobRows.filter((job: any) => !job.crewId),
        assignedJobs: jobRows.filter((job: any) => Boolean(job.crewId)),
      },
    });
  } catch (error) {
    return fail(error, 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { client } = await requireAdmin(request);
    const body = await request.json() as { jobIds?: string[]; crewId?: string; routeDate?: string };
    const jobIds = [...new Set((body.jobIds || []).filter(Boolean))];
    if (!body.crewId) throw new Error("Select an Employee.");
    if (!body.routeDate) throw new Error("Select a route date.");
    if (!jobIds.length) throw new Error("Select at least one customer.");
    for (let index = 0; index < jobIds.length; index++) {
      const { error } = await client.rpc("save_job_route_pattern", {
        p_job_id: jobIds[index],
        p_crew_id: body.crewId,
        p_route_date: body.routeDate,
        p_route_order: index + 1,
      });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ saved: true, count: jobIds.length });
  } catch (error) {
    return fail(error);
  }
}
