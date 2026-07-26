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

type RouteVisitRow = {
  id: string;
  company_id: string | null;
  organization_id: string | null;
  job_id: string | null;
  route_id: string | null;
  customer_id: string | null;
  property_id: string | null;
  crew_id: string | null;
  assigned_employee_id: string | null;
  route_order: number | null;
  status: string;
  scheduled_date: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
};

type PropertyRow = {
  id: string;
  address_line1: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type RouteStop = {
  visitId: string;
  jobId: string | null;
  customerId: string | null;
  propertyId: string | null;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  routeOrder: number | null;
  status: string;
  customerName: string;
  serviceName: string;
  scheduledDate: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  employeeNotes: string | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Employee route service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Employee authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function uniqueIds(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function requireEmployee(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");

  const auth = userClient(token);
  const { data: userResult, error: userError } = await auth.auth.getUser(token);
  const user = userResult.user;
  if (userError || !user) throw new Error("Your login expired. Sign in again.");

  const { data: profile, error: profileError } = await auth
    .from("profiles")
    .select("id,role,active,company_id,organization_id,email,full_name,avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "employee") {
    throw new Error("This login is not an active Employee account.");
  }

  const profileCompanyId = profile.company_id || profile.organization_id || null;
  if (!profileCompanyId) throw new Error("This Employee profile is not linked to a company.");

  const client = serviceClient();
  const columns = "id,profile_id,company_id,organization_id,full_name,email,crew_id,active";
  let { data: employee, error: employeeError } = await client
    .from("employees")
    .select(columns)
    .eq("profile_id", user.id)
    .eq("active", true)
    .or(companyFilter(profileCompanyId))
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);

  if (!employee && user.email) {
    const normalized = user.email.trim().toLowerCase();
    const result = await client
      .from("employees")
      .select(columns)
      .ilike("email", normalized)
      .eq("active", true)
      .or(companyFilter(profileCompanyId))
      .order("created_at", { ascending: true })
      .limit(2);
    if (result.error) throw new Error(result.error.message);
    if ((result.data || []).length > 1) {
      throw new Error("More than one active Employee record matches this login. Ask Admin to keep only the canonical record.");
    }

    employee = result.data?.[0] || null;
    if (employee) {
      const employeeCompanyId = employee.company_id || employee.organization_id || profileCompanyId;
      const { data: linked, error: linkError } = await client
        .from("employees")
        .update({
          profile_id: user.id,
          email: normalized,
          company_id: employeeCompanyId,
          organization_id: employeeCompanyId,
        })
        .eq("id", employee.id)
        .select(columns)
        .single();
      if (linkError) throw new Error(linkError.message);
      employee = linked;

      const profileUpdate = await client
        .from("profiles")
        .update({ email: normalized, company_id: employeeCompanyId, organization_id: employeeCompanyId })
        .eq("id", user.id);
      if (profileUpdate.error) throw new Error(profileUpdate.error.message);
    }
  }

  if (!employee) {
    throw new Error("No active Employee record matches this login. Ask the company Admin to connect the Employee account.");
  }

  const companyId = employee.company_id || employee.organization_id || profileCompanyId;
  if (companyId !== profileCompanyId) {
    throw new Error("Employee and profile belong to different companies. Ask Admin to repair the canonical account link.");
  }

  return {
    client,
    employee: employee as EmployeeRow,
    userId: user.id,
    companyId,
    avatarUrl: profile.avatar_url || null,
  };
}

async function loadProperties(
  client: ReturnType<typeof serviceClient>,
  propertyIds: string[],
  companyId: string,
): Promise<PropertyRow[]> {
  if (!propertyIds.length) return [];

  const withCoordinates = await client
    .from("properties")
    .select("id,address_line1,city,province,postal_code,latitude,longitude")
    .in("id", propertyIds)
    .or(companyFilter(companyId));

  if (!withCoordinates.error) return (withCoordinates.data || []) as PropertyRow[];

  const missingCoordinates = /column properties\.(latitude|longitude) does not exist/i.test(withCoordinates.error.message);
  if (!missingCoordinates) throw new Error(withCoordinates.error.message);

  const fallback = await client
    .from("properties")
    .select("id,address_line1,city,province,postal_code")
    .in("id", propertyIds)
    .or(companyFilter(companyId));
  if (fallback.error) throw new Error(fallback.error.message);

  console.warn("employee-route-properties-without-coordinates", {
    companyId,
    propertyCount: propertyIds.length,
  });
  return (fallback.data || []) as PropertyRow[];
}

async function loadRoute(
  client: ReturnType<typeof serviceClient>,
  employee: EmployeeRow,
  companyId: string,
  date: string,
  avatarUrl: string | null,
) {
  const visitResult = await client
    .from("visits")
    .select("id,company_id,organization_id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds")
    .eq("scheduled_date", date)
    .or(companyFilter(companyId))
    .neq("status", "cancelled")
    .order("route_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (visitResult.error) throw new Error(visitResult.error.message);

  const rows = ((visitResult.data || []) as RouteVisitRow[]).filter(
    (row) =>
      row.assigned_employee_id === employee.id ||
      Boolean(!row.assigned_employee_id && employee.crew_id && row.crew_id === employee.crew_id),
  );

  const propertyIds = uniqueIds(rows.map((row) => row.property_id));
  const customerIds = uniqueIds(rows.map((row) => row.customer_id));
  const jobIds = uniqueIds(rows.map((row) => row.job_id));
  const visitIds = rows.map((row) => row.id);
  const empty = Promise.resolve({ data: [] as any[], error: null });

  const [propertyRows, customerResult, jobResult, noteResult] = await Promise.all([
    loadProperties(client, propertyIds, companyId),
    customerIds.length
      ? client.from("customers").select("id,full_name").in("id", customerIds).or(companyFilter(companyId))
      : empty,
    jobIds.length
      ? client.from("jobs").select("id,service_name").in("id", jobIds).or(companyFilter(companyId))
      : empty,
    visitIds.length
      ? client
          .from("activity_log")
          .select("entity_id,details,created_at")
          .eq("organization_id", companyId)
          .eq("entity_type", "visit")
          .eq("action", "visit.employee_note")
          .in("entity_id", visitIds)
          .order("created_at", { ascending: false })
      : empty,
  ]);

  if (customerResult.error) throw new Error(customerResult.error.message);
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (noteResult.error) throw new Error(noteResult.error.message);

  const properties = new Map(propertyRows.map((row) => [row.id, row]));
  const customers = new Map((customerResult.data || []).map((row: any) => [row.id, row]));
  const jobs = new Map((jobResult.data || []).map((row: any) => [row.id, row]));
  const notes = new Map<string, string | null>();
  for (const row of noteResult.data || []) {
    if (row.entity_id && !notes.has(row.entity_id)) notes.set(row.entity_id, row.details || null);
  }

  const stops: RouteStop[] = rows.map((row) => {
    const property = properties.get(row.property_id || "");
    const customer = customers.get(row.customer_id || "") as any;
    const job = jobs.get(row.job_id || "") as any;
    return {
      visitId: row.id,
      jobId: row.job_id,
      customerId: row.customer_id,
      propertyId: row.property_id,
      addressLine1: property?.address_line1 || "",
      city: property?.city || "",
      province: property?.province || "",
      postalCode: property?.postal_code || "",
      latitude: property?.latitude ?? null,
      longitude: property?.longitude ?? null,
      routeOrder: row.route_order,
      status: row.status,
      customerName: customer?.full_name || "Customer",
      serviceName: job?.service_name || "Property Service",
      scheduledDate: row.scheduled_date,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      durationSeconds: row.duration_seconds ?? null,
      employeeNotes: notes.get(row.id) || null,
    };
  });

  return {
    employee: {
      id: employee.id,
      profileId: employee.profile_id,
      companyId,
      name: employee.full_name || "Employee",
      crewId: employee.crew_id || null,
      email: employee.email || null,
      avatarUrl,
    },
    routeId: rows.find((row) => row.route_id)?.route_id || null,
    stops,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { client, employee, companyId, avatarUrl } = await requireEmployee(request);
    const date = request.nextUrl.searchParams.get("date") || torontoDateKey();
    const payload = await loadRoute(client, employee, companyId, date, avatarUrl);
    console.info("employee-route-get-ok", {
      employeeId: employee.id,
      companyId,
      date,
      routeId: payload.routeId,
      stopCount: payload.stops.length,
      visitIds: payload.stops.map((stop) => stop.visitId),
      customerIds: uniqueIds(payload.stops.map((stop) => stop.customerId)),
      propertyIds: uniqueIds(payload.stops.map((stop) => stop.propertyId)),
      jobIds: uniqueIds(payload.stops.map((stop) => stop.jobId)),
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
    const { client, employee, userId, companyId } = await requireEmployee(request);
    const body = (await request.json()) as {
      visitId?: string;
      action?: "start" | "done" | "note";
      note?: string;
    };
    if (!body.visitId) throw new Error("Choose a visit first.");

    const { data: visit, error: visitError } = await client
      .from("visits")
      .select("id,company_id,organization_id,assigned_employee_id,crew_id,status,started_at,scheduled_date")
      .eq("id", body.visitId)
      .or(companyFilter(companyId))
      .maybeSingle();
    if (visitError || !visit) throw new Error(visitError?.message || "Visit not found.");

    const allowed =
      visit.assigned_employee_id === employee.id ||
      Boolean(!visit.assigned_employee_id && employee.crew_id && visit.crew_id === employee.crew_id);
    if (!allowed) throw new Error("This visit is not assigned to this Employee or as an unassigned crew visit.");

    if (body.action === "note") {
      const note = String(body.note || "").trim();
      const noteInsert = await client.from("activity_log").insert({
        organization_id: companyId,
        company_id: companyId,
        actor_profile_id: userId,
        action: "visit.employee_note",
        entity_type: "visit",
        entity_id: visit.id,
        details: note || null,
      });
      if (noteInsert.error) throw new Error(noteInsert.error.message);
      return NextResponse.json({ visit: { id: visit.id, employeeNotes: note || null } });
    }

    const now = new Date();
    const patch: Record<string, unknown> = {};
    if (body.action === "start") {
      if (["completed", "cancelled"].includes(visit.status)) {
        throw new Error("This visit can no longer be started.");
      }
      patch.status = "in_progress";
      patch.started_at = visit.started_at || now.toISOString();
      patch.finished_at = null;
    } else if (body.action === "done") {
      if (visit.status === "cancelled") throw new Error("A cancelled visit cannot be completed.");
      const startedAt = visit.started_at ? new Date(visit.started_at).getTime() : now.getTime();
      patch.status = "completed";
      patch.started_at = visit.started_at || now.toISOString();
      patch.finished_at = now.toISOString();
      patch.duration_seconds = Math.max(0, Math.round((now.getTime() - startedAt) / 1000));
    } else {
      throw new Error("Choose a valid visit action.");
    }

    const { data: updated, error: updateError } = await client
      .from("visits")
      .update(patch)
      .eq("id", visit.id)
      .or(companyFilter(companyId))
      .select("id,status,started_at,finished_at,duration_seconds")
      .single();
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ visit: updated });
  } catch (error) {
    console.error("employee-route-patch", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Visit could not be updated." },
      { status: 400 },
    );
  }
}
