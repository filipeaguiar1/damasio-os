import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type EmployeeRow = {
  id: string;
  profile_id: string | null;
  company_id: string | null;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  crew_id: string | null;
  active: boolean;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Employee route service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Employee authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function missingMigration(message?: string) {
  return /transition_visit_execution|schema cache|could not find the function/i.test(message || "");
}

async function requireEmployee(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");

  const authClient = userClient(token);
  const { data: userResult, error: userError } = await authClient.auth.getUser(token);
  const user = userResult.user;
  if (userError || !user) throw new Error("Your Employee login expired. Sign in again.");

  const service = serviceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.active || profile.role !== "employee") {
    throw new Error("This login is not an active Employee account.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This Employee profile is not linked to a company.");

  const { data: employee, error: employeeError } = await service
    .from("employees")
    .select("id,profile_id,company_id,organization_id,full_name,email,crew_id,active")
    .eq("profile_id", user.id)
    .eq("active", true)
    .or(companyFilter(companyId))
    .maybeSingle();

  if (employeeError) throw new Error(employeeError.message);
  if (!employee) {
    throw new Error("No canonical Employee ID is linked to this login. Admin must repair the profile_id link.");
  }

  if ((employee.company_id || employee.organization_id) !== companyId) {
    throw new Error("Employee and profile belong to different companies.");
  }

  return {
    service,
    user: authClient,
    employee: employee as EmployeeRow,
    userId: user.id,
    companyId,
    avatarUrl: profile.avatar_url || null,
  };
}

async function loadRoute(
  service: any,
  employee: EmployeeRow,
  companyId: string,
  date: string,
  avatarUrl: string | null,
) {
  const result = await service
    .from("visits")
    .select("id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,created_at")
    .eq("scheduled_date", date)
    .neq("status", "cancelled")
    .or(companyFilter(companyId))
    .order("route_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (result.error) throw new Error(result.error.message);

  const visits = (result.data || []).filter((visit: any) =>
    Boolean(visit.route_id)
    && (
      visit.assigned_employee_id === employee.id
      || (
        !visit.assigned_employee_id
        && Boolean(employee.crew_id)
        && visit.crew_id === employee.crew_id
      )
    ));

  const propertyIds = unique(visits.map((visit: any) => visit.property_id));
  const customerIds = unique(visits.map((visit: any) => visit.customer_id));
  const jobIds = unique(visits.map((visit: any) => visit.job_id));
  const visitIds = unique(visits.map((visit: any) => visit.id));
  const empty = Promise.resolve({ data: [] as any[], error: null });

  const [propertiesResult, customersResult, jobsResult, notesResult] = await Promise.all([
    propertyIds.length
      ? service
        .from("properties")
        .select("id,address_line1,city,province,postal_code")
        .in("id", propertyIds)
        .or(companyFilter(companyId))
      : empty,
    customerIds.length
      ? service.from("customers").select("id,full_name").in("id", customerIds).or(companyFilter(companyId))
      : empty,
    jobIds.length
      ? service.from("jobs").select("id,service_name").in("id", jobIds).or(companyFilter(companyId))
      : empty,
    visitIds.length
      ? service
        .from("activity_log")
        .select("entity_id,details,created_at")
        .eq("company_id", companyId)
        .eq("entity_type", "visit")
        .eq("action", "visit.employee_note")
        .in("entity_id", visitIds)
        .order("created_at", { ascending: false })
      : empty,
  ]);

  for (const current of [propertiesResult, customersResult, jobsResult]) {
    if (current.error) throw new Error(current.error.message);
  }

  const properties = new Map((propertiesResult.data || []).map((row: any) => [row.id, row]));
  const customers = new Map((customersResult.data || []).map((row: any) => [row.id, row]));
  const jobs = new Map((jobsResult.data || []).map((row: any) => [row.id, row]));
  const notes = new Map<string, string | null>();
  for (const note of notesResult.data || []) {
    if (note.entity_id && !notes.has(note.entity_id)) notes.set(note.entity_id, note.details || null);
  }

  const stops = visits.map((visit: any) => {
    const property = properties.get(visit.property_id) as any;
    const customer = customers.get(visit.customer_id) as any;
    const job = jobs.get(visit.job_id) as any;
    return {
      visitId: visit.id,
      jobId: visit.job_id,
      customerId: visit.customer_id,
      propertyId: visit.property_id,
      addressLine1: property?.address_line1 || "",
      city: property?.city || "",
      province: property?.province || "",
      postalCode: property?.postal_code || "",
      latitude: null,
      longitude: null,
      routeOrder: visit.route_order,
      status: visit.status,
      customerName: customer?.full_name || "Customer",
      serviceName: job?.service_name || "Property Service",
      scheduledDate: visit.scheduled_date,
      startedAt: visit.started_at,
      finishedAt: visit.finished_at,
      durationSeconds: visit.duration_seconds,
      employeeNotes: notes.get(visit.id) || null,
    };
  });

  return {
    employee: {
      id: employee.id,
      profileId: employee.profile_id,
      companyId,
      name: employee.full_name || "Employee",
      crewId: employee.crew_id,
      email: employee.email,
      avatarUrl,
    },
    routeId: visits.find((visit: any) => visit.route_id)?.route_id || null,
    stops,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { service, employee, companyId, avatarUrl } = await requireEmployee(request);
    const date = request.nextUrl.searchParams.get("date") || torontoDateKey();
    const payload = await loadRoute(service, employee, companyId, date, avatarUrl);

    console.info("employee-route-get-ok", {
      employeeId: employee.id,
      companyId,
      date,
      routeId: payload.routeId,
      stopCount: payload.stops.length,
      visitIds: payload.stops.map((stop: any) => stop.visitId),
      jobIds: unique(payload.stops.map((stop: any) => stop.jobId)),
      propertyIds: unique(payload.stops.map((stop: any) => stop.propertyId)),
      customerIds: unique(payload.stops.map((stop: any) => stop.customerId)),
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("employee-route-get", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Employee route could not be loaded." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { service, user, userId, companyId } = await requireEmployee(request);
    const body = await request.json() as {
      visitId?: string;
      action?: "start" | "done" | "reset" | "skip" | "reopen" | "note";
      note?: string;
      reason?: string;
    };

    const visitId = String(body.visitId || "");
    if (!visitId) throw new Error("Choose a canonical Visit first.");

    if (body.action === "note") {
      const note = String(body.note || "").trim();
      const inserted = await service.from("activity_log").insert({
        organization_id: companyId,
        company_id: companyId,
        actor_profile_id: userId,
        action: "visit.employee_note",
        entity_type: "visit",
        entity_id: visitId,
        details: note || null,
        metadata: { visit_id: visitId },
      });
      if (inserted.error) throw new Error(inserted.error.message);
      return NextResponse.json({ visit: { id: visitId, employeeNotes: note || null } });
    }

    const action = String(body.action || "");
    if (!["start", "done", "reset", "skip", "reopen"].includes(action)) {
      throw new Error("Choose a valid canonical Visit action.");
    }

    const reason = String(body.reason || "").trim();
    if (["reset", "reopen"].includes(action) && reason.length < 5) {
      throw new Error(`${action === "reset" ? "Reset" : "Reopen"} requires a reason with at least 5 characters.`);
    }

    const result = await user.rpc("transition_visit_execution", {
      p_visit_id: visitId,
      p_action: action,
      p_reason: reason || null,
    });

    if (result.error) {
      if (missingMigration(result.error.message)) {
        throw new Error("Supabase migration 202607270003_completed_visit_reopen_guard.sql is pending or not confirmed.");
      }
      throw new Error(result.error.message);
    }

    return NextResponse.json({ visit: result.data });
  } catch (error) {
    console.error("employee-route-patch", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Visit could not be updated." },
      { status: 400 },
    );
  }
}
