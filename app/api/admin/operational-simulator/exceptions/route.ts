import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const RAIN_MARKER = "[SIM_EXCEPTION_RAIN]";
const LATE_MARKER = "[SIM_EXCEPTION_LATE]";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational simulator is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function simulationPattern(companyId: string) {
  return `ops-sim-${companyId.slice(0, 8)}-%@4everseasons.test`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftIso(value: string | null, days: number, minutes = 0) {
  if (!value) return null;
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function appendText(value: string | null | undefined, marker: string, text: string) {
  const current = String(value || "").trim();
  if (current.includes(marker)) return current;
  return `${current}${current ? " " : ""}${marker} ${text}`;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");
  const profile = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || !["admin", "manager"].includes(profile.data.role)) {
    throw new Error("Only an active company Admin can run exception simulations.");
  }
  const companyId = String(profile.data.company_id || profile.data.organization_id || "");
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

type VisitRow = {
  id: string;
  customer_id: string;
  route_id: string | null;
  scheduled_date: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  employee_notes: string | null;
  customer_visible_summary: string | null;
};

async function simulationCustomerIds(service: any, companyId: string) {
  const customers = await service.from("customers").select("id")
    .or(companyFilter(companyId))
    .like("email", simulationPattern(companyId))
    .is("archived_at", null);
  if (customers.error) throw new Error(customers.error.message);
  return (customers.data || []).map((row: any) => String(row.id));
}

async function completedVisits(service: any, companyId: string, customerIds: string[]): Promise<VisitRow[]> {
  if (!customerIds.length) return [];
  const result = await service.from("visits")
    .select("id,customer_id,route_id,scheduled_date,status,started_at,finished_at,duration_seconds,employee_notes,customer_visible_summary")
    .in("customer_id", customerIds)
    .or(companyFilter(companyId))
    .eq("status", "completed")
    .order("scheduled_date", { ascending: false })
    .order("route_order", { ascending: true })
    .limit(200);
  if (result.error) throw new Error(`visits: ${result.error.message}`);
  return (result.data || []) as VisitRow[];
}

async function exceptionStatus(service: any, companyId: string) {
  const customerIds = await simulationCustomerIds(service, companyId);
  if (!customerIds.length) {
    return {
      exists: false,
      weatherRescheduledVisits: 0,
      lateVisits: 0,
      lowRatings: 0,
      openTasks: 0,
      returnRequests: 0,
    };
  }

  const visits = await completedVisits(service, companyId, customerIds);
  const [feedback, tasks, requests] = await Promise.all([
    service.from("feedback").select("id,rating").in("customer_id", customerIds),
    service.from("tasks").select("id,status").in("customer_id", customerIds),
    service.from("service_requests").select("id,status,service_name").in("customer_id", customerIds),
  ]);
  if (feedback.error) throw new Error(`feedback: ${feedback.error.message}`);
  if (tasks.error) throw new Error(`tasks: ${tasks.error.message}`);
  if (requests.error) throw new Error(`service_requests: ${requests.error.message}`);

  return {
    exists: true,
    weatherRescheduledVisits: visits.filter(row => String(row.employee_notes || "").includes(RAIN_MARKER)).length,
    lateVisits: visits.filter(row => String(row.employee_notes || "").includes(LATE_MARKER)).length,
    lowRatings: (feedback.data || []).filter((row: any) => Number(row.rating) <= 3).length,
    openTasks: (tasks.data || []).filter((row: any) => !["resolved", "closed", "done"].includes(String(row.status || "").toLowerCase())).length,
    returnRequests: (requests.data || []).filter((row: any) => /return visit/i.test(String(row.service_name || ""))).length,
  };
}

async function seedExceptionWeek(service: any, companyId: string) {
  const customerIds = await simulationCustomerIds(service, companyId);
  if (!customerIds.length) throw new Error("Create the two-month operational simulation first.");
  const visits = await completedVisits(service, companyId, customerIds);
  if (!visits.length) throw new Error("No completed simulation Visits were found.");

  const alreadySeeded = visits.some(row => String(row.employee_notes || "").includes(RAIN_MARKER))
    || visits.some(row => String(row.employee_notes || "").includes(LATE_MARKER));
  if (alreadySeeded) return exceptionStatus(service, companyId);

  const routeGroups = new Map<string, VisitRow[]>();
  for (const visit of visits) {
    if (!visit.route_id) continue;
    const group = routeGroups.get(visit.route_id) || [];
    group.push(visit);
    routeGroups.set(visit.route_id, group);
  }
  const rainVisits = [...routeGroups.values()].find(group => group.length >= 8)?.slice(0, 8) || [];
  const rainAnchor = rainVisits[0];
  if (!rainAnchor?.route_id) throw new Error("A historical eight-stop Route is required for the rain scenario.");
  const rainDate = addDays(rainAnchor.scheduled_date, 4);

  const routeUpdate = await service.from("routes")
    .update({ route_date: rainDate })
    .eq("id", rainAnchor.route_id)
    .or(companyFilter(companyId));
  if (routeUpdate.error) throw new Error(`routes: ${routeUpdate.error.message}`);

  for (const visit of rainVisits) {
    const update = await service.from("visits").update({
      scheduled_date: rainDate,
      started_at: shiftIso(visit.started_at, 4),
      finished_at: shiftIso(visit.finished_at, 4),
      employee_notes: appendText(visit.employee_notes, RAIN_MARKER, "Route moved to the next available service day because of rain."),
      customer_visible_summary: appendText(visit.customer_visible_summary, RAIN_MARKER, "Service was rescheduled because of rain and then completed."),
    }).eq("id", visit.id).or(companyFilter(companyId));
    if (update.error) throw new Error(`visits: ${update.error.message}`);
  }

  const rainIds = new Set(rainVisits.map(row => row.id));
  const lateVisit = visits.find(row => !rainIds.has(row.id));
  if (!lateVisit) throw new Error("A second completed Visit is required for the late-arrival scenario.");
  const lateUpdate = await service.from("visits").update({
    started_at: shiftIso(lateVisit.started_at, 0, 20),
    finished_at: shiftIso(lateVisit.finished_at, 0, 20),
    employee_notes: appendText(lateVisit.employee_notes, LATE_MARKER, "Crew arrived 20 minutes late; route timing was updated."),
    customer_visible_summary: appendText(lateVisit.customer_visible_summary, LATE_MARKER, "The crew arrived later than planned and completed the service."),
  }).eq("id", lateVisit.id).or(companyFilter(companyId));
  if (lateUpdate.error) throw new Error(`visits: ${lateUpdate.error.message}`);

  return exceptionStatus(service, companyId);
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    return NextResponse.json({ status: await exceptionStatus(service, companyId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Exception status failed." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    const status = await seedExceptionWeek(service, companyId);
    return NextResponse.json({
      seeded: true,
      status,
      message: `Exception week seeded: ${status.weatherRescheduledVisits} rain-rescheduled Visits and ${status.lateVisits} late arrival.`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Exception simulation failed." }, { status: 400 });
  }
}
