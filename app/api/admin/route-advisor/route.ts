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

function isMissingCapacityColumn(message?: string) {
  return /daily_route_capacity/i.test(message || "") && /(column|schema cache|does not exist)/i.test(message || "");
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
    throw new Error("Only an active company Admin can publish routes.");
  }
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, user: userClient(token), companyId };
}

async function loadEmployee(service: any, companyId: string, employeeId?: string, crewId?: string) {
  const selectWithCapacity = "id,profile_id,crew_id,full_name,active,daily_route_capacity";
  let query = service.from("employees").select(selectWithCapacity).eq("active", true).or(companyFilter(companyId));
  query = employeeId ? query.eq("id", employeeId) : query.eq("crew_id", crewId || "");
  let result = await query.limit(2);
  if (result.error && isMissingCapacityColumn(result.error.message)) {
    let fallback = service.from("employees").select("id,profile_id,crew_id,full_name,active").eq("active", true).or(companyFilter(companyId));
    fallback = employeeId ? fallback.eq("id", employeeId) : fallback.eq("crew_id", crewId || "");
    result = await fallback.limit(2);
  }
  if (result.error) throw new Error(result.error.message);
  if ((result.data || []).length !== 1) throw new Error("The route must resolve to exactly one active Employee.");
  const employee = result.data[0];
  return { ...employee, daily_route_capacity: Math.max(1, Number(employee.daily_route_capacity || 16)) };
}

async function loadDateVisits(service: any, companyId: string, date: string) {
  const result = await service
    .from("visits")
    .select("id,job_id,route_id,assigned_employee_id,crew_id,status,scheduled_date,route_order,started_at,finished_at,duration_seconds,created_at")
    .eq("scheduled_date", date)
    .or(companyFilter(companyId))
    .order("created_at", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}

function belongsToEmployee(visit: any, employee: any) {
  if (visit.assigned_employee_id) return visit.assigned_employee_id === employee.id;
  return Boolean(employee.crew_id && visit.crew_id === employee.crew_id);
}

function locked(visit: any) {
  return ["completed", "in_progress"].includes(visit.status);
}

async function ensureRoute(service: any, companyId: string, crewId: string, routeDate: string) {
  const existing = await service
    .from("routes")
    .select("id")
    .eq("crew_id", crewId)
    .eq("route_date", routeDate)
    .or(companyFilter(companyId))
    .order("created_at")
    .limit(2);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data || []).length > 1) throw new Error("More than one canonical Route exists for this Employee and date.");
  const existingId = existing.data?.[0]?.id;
  if (existingId) {
    const updated = await service.from("routes").update({ status: "published" }).eq("id", existingId);
    if (updated.error) throw new Error(updated.error.message);
    return existingId as string;
  }
  const created = await service.from("routes").insert({
    organization_id: companyId,
    company_id: companyId,
    crew_id: crewId,
    route_date: routeDate,
    status: "published",
  }).select("id").single();
  if (created.error) throw new Error(created.error.message);
  return created.data.id as string;
}

async function detachVisits(service: any, visits: any[]) {
  const mutable = visits.filter(visit => !locked(visit));
  if (!mutable.length) return;
  const result = await service.from("visits").update({
    route_id: null,
    assigned_employee_id: null,
    crew_id: null,
    route_order: null,
  }).in("id", mutable.map(visit => visit.id));
  if (result.error) throw new Error(result.error.message);
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const body = await request.json() as {
      employeeId?: string;
      crewId?: string;
      routeDate?: string;
      orderedJobIds?: string[];
      removeFrom?: { employeeId?: string; crewId?: string; routeDate?: string; jobIds?: string[] };
    };
    const routeDate = String(body.routeDate || "");
    const orderedJobIds = [...new Set((body.orderedJobIds || []).map(String).filter(Boolean))];
    if (!routeDate) throw new Error("Choose a route date.");
    if (!orderedJobIds.length) throw new Error("Keep at least one house in the route preview.");

    const employee = await loadEmployee(service, companyId, body.employeeId, body.crewId);
    if (!employee.crew_id) throw new Error("The selected Employee has no canonical route crew.");
    const dateVisits = await loadDateVisits(service, companyId, routeDate);
    const currentRoute = dateVisits.filter((visit: any) => visit.status !== "cancelled" && belongsToEmployee(visit, employee));
    const lockedVisits = currentRoute.filter(locked);
    const lockedJobIds = lockedVisits.map((visit: any) => visit.job_id).filter(Boolean);
    const missingLocked = lockedJobIds.filter((jobId: string) => !orderedJobIds.includes(jobId));
    if (missingLocked.length) throw new Error("Completed or active houses are locked and must remain on this dated route.");
    const capacity = employee.daily_route_capacity;
    if (orderedJobIds.length > capacity) {
      throw new Error(`${employee.full_name || "Employee"} allows ${capacity} houses per day. Remove ${orderedJobIds.length - capacity} before publishing.`);
    }

    const jobsResult = await service
      .from("jobs")
      .select("id,customer_id,property_id,frequency,next_visit_date")
      .in("id", orderedJobIds)
      .eq("active", true)
      .or(companyFilter(companyId));
    if (jobsResult.error) throw new Error(jobsResult.error.message);
    const jobs = jobsResult.data || [];
    if (jobs.length !== orderedJobIds.length) throw new Error("One or more selected Jobs are no longer active in this company.");
    const incomplete = jobs.find((job: any) => !job.customer_id || !job.property_id);
    if (incomplete) throw new Error(`Job ${incomplete.id} is missing its canonical Customer or Property link.`);

    for (const jobId of orderedJobIds) {
      const assignment = await user.rpc("assign_job_to_crew", { p_job_id: jobId, p_crew_id: employee.crew_id });
      if (assignment.error) throw new Error(assignment.error.message);
    }

    const routeId = await ensureRoute(service, companyId, employee.crew_id, routeDate);
    const keep = new Set(orderedJobIds);
    await detachVisits(service, currentRoute.filter((visit: any) => visit.job_id && !keep.has(visit.job_id)));

    for (let index = 0; index < orderedJobIds.length; index++) {
      const jobId = orderedJobIds[index];
      const job = jobs.find((item: any) => item.id === jobId);
      const sameJobDate = dateVisits.filter((visit: any) => visit.job_id === jobId);
      const activeVisits = sameJobDate.filter((visit: any) => visit.status !== "cancelled");
      const current = activeVisits[0] || null;
      if (activeVisits.length > 1) {
        const duplicateIds = activeVisits.slice(1).map((visit: any) => visit.id);
        const cancelled = await service.from("visits").update({ status: "cancelled", route_id: null, assigned_employee_id: null, crew_id: null, route_order: null }).in("id", duplicateIds);
        if (cancelled.error) throw new Error(cancelled.error.message);
      }
      const preserveStatus = current && locked(current);
      const patch = {
        route_id: routeId,
        crew_id: employee.crew_id,
        assigned_employee_id: employee.id,
        customer_id: job.customer_id,
        property_id: job.property_id,
        scheduled_date: routeDate,
        route_order: index + 1,
        status: preserveStatus ? current.status : "scheduled",
        ...(preserveStatus ? {
          started_at: current.started_at,
          finished_at: current.finished_at,
          duration_seconds: current.duration_seconds,
        } : {
          started_at: null,
          finished_at: null,
          duration_seconds: null,
        }),
      };
      if (current?.id) {
        const updated = await service.from("visits").update(patch).eq("id", current.id);
        if (updated.error) throw new Error(updated.error.message);
      } else {
        const inserted = await service.from("visits").insert({
          organization_id: companyId,
          company_id: companyId,
          job_id: jobId,
          ...patch,
        });
        if (inserted.error) throw new Error(inserted.error.message);
      }
      const jobPatch: Record<string, unknown> = {
        recurrence_anchor_date: routeDate,
        default_route_order: index + 1,
      };
      if (!preserveStatus) jobPatch.next_visit_date = routeDate;
      const jobUpdate = await service.from("jobs").update(jobPatch).eq("id", jobId).or(companyFilter(companyId));
      if (jobUpdate.error) throw new Error(jobUpdate.error.message);
    }

    if (body.removeFrom?.routeDate && body.removeFrom.jobIds?.length) {
      const source = await loadEmployee(service, companyId, body.removeFrom.employeeId, body.removeFrom.crewId);
      const sourceDateVisits = await loadDateVisits(service, companyId, body.removeFrom.routeDate);
      const moving = new Set(body.removeFrom.jobIds.map(String));
      const sourceVisits = sourceDateVisits.filter((visit: any) =>
        visit.status !== "cancelled" && belongsToEmployee(visit, source) && moving.has(visit.job_id));
      if (sourceVisits.some(locked)) throw new Error("Completed or active houses cannot be moved to another route.");
      await detachVisits(service, sourceVisits);
    }

    const verification = await service
      .from("visits")
      .select("id,job_id,route_id,assigned_employee_id,crew_id,customer_id,property_id,scheduled_date,route_order,status")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .order("route_order");
    if (verification.error) throw new Error(verification.error.message);
    const saved = verification.data || [];
    if (saved.length !== orderedJobIds.length) throw new Error("The reviewed route was not fully saved.");
    const invalid = saved.find((visit: any) =>
      !visit.job_id || !visit.customer_id || !visit.property_id || !visit.assigned_employee_id || !visit.crew_id || !visit.route_order);
    if (invalid) throw new Error(`Visit ${invalid.id} failed canonical route verification.`);

    return NextResponse.json({
      saved: true,
      routeId,
      employeeId: employee.id,
      employeeName: employee.full_name,
      count: saved.length,
      capacity,
      visits: saved,
    });
  } catch (error) {
    console.error("admin-route-advisor-post", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route Advisor request failed." }, { status: 400 });
  }
}
