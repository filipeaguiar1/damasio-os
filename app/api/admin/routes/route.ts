import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route administration is not configured.");
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

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const client = serviceClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active company Admin can manage routes.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service: client, user: userClient(token), companyId };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Route request failed." }, { status });
}

async function ensureEmployees(service: any, companyId: string) {
  const { data: profiles, error: profileError } = await service
    .from("profiles")
    .select("id,full_name,email,address_line1,route_start_address,active")
    .eq("role", "employee")
    .eq("active", true)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .order("full_name");
  if (profileError) throw new Error(profileError.message);

  const { data: existing, error: employeeError } = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if (employeeError) throw new Error(employeeError.message);

  const byProfile = new Map<string, any>();
  for (const row of existing || []) if (row.profile_id) byProfile.set(row.profile_id, row);

  const result: any[] = [];
  for (const profile of profiles || []) {
    let employee = byProfile.get(profile.id);
    if (!employee) {
      const { data: created, error } = await service.from("employees").insert({
        company_id: companyId,
        organization_id: companyId,
        profile_id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        address_line1: profile.address_line1,
        route_start_address: profile.route_start_address || profile.address_line1,
        active: true,
        invite_status: "sent",
      }).select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active").single();
      if (error) throw new Error(error.message);
      employee = created;
    }

    if (!employee.crew_id) {
      const { data: crew, error: crewError } = await service.from("crews").insert({
        company_id: companyId,
        organization_id: companyId,
        name: employee.full_name || profile.full_name || "Employee route",
        active: true,
      }).select("id").single();
      if (crewError) throw new Error(crewError.message);
      const { error: linkError } = await service.from("employees").update({ crew_id: crew.id }).eq("id", employee.id);
      if (linkError) throw new Error(linkError.message);
      employee.crew_id = crew.id;
    }

    result.push({
      id: profile.id,
      employeeId: employee.id,
      crewId: employee.crew_id,
      name: profile.full_name || employee.full_name || "Employee",
      email: profile.email || employee.email || "",
      routeStartAddress: profile.route_start_address || profile.address_line1 || employee.route_start_address || employee.address_line1 || null,
    });
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const employees = await ensureEmployees(service, companyId);
    const { data: jobs, error: jobsError } = await user.rpc("get_company_dispatch_jobs");
    if (jobsError) throw new Error(jobsError.message);
    const jobRows = Array.isArray(jobs) ? jobs : [];
    return NextResponse.json({
      employees,
      board: {
        crews: [],
        unscheduledJobs: jobRows.filter((job: any) => !job.crewId),
        assignedJobs: jobRows.filter((job: any) => Boolean(job.crewId)),
        visits: [],
        tasks: [],
        activity: [],
      },
    });
  } catch (error) {
    return fail(error, 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const body = await request.json() as { jobIds?: string[]; crewId?: string; routeDate?: string };
    const jobIds = [...new Set((body.jobIds || []).filter(Boolean))];
    if (!body.crewId) throw new Error("Select an Employee.");
    if (!body.routeDate) throw new Error("Select a route date.");
    if (!jobIds.length) throw new Error("Select at least one customer.");
    for (let index = 0; index < jobIds.length; index++) {
      const { error } = await user.rpc("save_job_route_pattern", {
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
