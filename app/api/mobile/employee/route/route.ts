import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeVisitExecutionState } from "@/lib/visits/executionState";

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

type VisitAction = "start" | "done" | "reset" | "skip" | "reopen";

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

function elapsedSeconds(startedAt: string, finishedAt = new Date()) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((finishedAt.getTime() - started) / 1000));
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

  // route_stops is the canonical source of route order. visits.route_order is
  // only a compatibility projection and may lag while database migrations roll
  // out, so Employee web/mobile must never reconstruct a published route from it.
  const routeIds = unique(visits.map((visit: any) => visit.route_id));
  const routeStopsResult = routeIds.length
    ? await service
      .from("route_stops")
      .select("route_id,visit_id,position")
      .in("route_id", routeIds)
    : { data: [] as any[], error: null };
  if (routeStopsResult.error) throw new Error(routeStopsResult.error.message);

  const canonicalPositions = new Map<string, number>(
    (routeStopsResult.data || []).map((stop: any) => [
      `${String(stop.route_id)}:${String(stop.visit_id)}`,
      Number(stop.position),
    ]),
  );
  const canonicalPosition = (visit: any) => canonicalPositions.get(
    `${String(visit.route_id)}:${String(visit.id)}`,
  );

  visits.sort((left: any, right: any) => {
    const leftCanonical = canonicalPosition(left);
    const rightCanonical = canonicalPosition(right);
    const leftOrder = Number.isFinite(leftCanonical)
      ? Number(leftCanonical)
      : Number.isFinite(Number(left.route_order)) ? Number(left.route_order) : 2147483647;
    const rightOrder = Number.isFinite(rightCanonical)
      ? Number(rightCanonical)
      : Number.isFinite(Number(right.route_order)) ? Number(right.route_order) : 2147483647;
    return leftOrder - rightOrder
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || String(left.id).localeCompare(String(right.id));
  });

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
    const execution = normalizeVisitExecutionState({
      status: visit.status,
      startedAt: visit.started_at,
      finishedAt: visit.finished_at,
      durationSeconds: visit.duration_seconds,
    });
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
      routeOrder: canonicalPosition(visit) ?? visit.route_order,
      status: visit.status,
      customerName: customer?.full_name || "Customer",
      serviceName: job?.service_name || "Property Service",
      scheduledDate: visit.scheduled_date,
      startedAt: execution.startedAt || null,
      finishedAt: execution.finishedAt || null,
      durationSeconds: execution.durationSeconds ?? null,
      executionStateValid: execution.valid,
      executionIssue: execution.issue || null,
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

async function fallbackVisitTransition(input: {
  service: any;
  employee: EmployeeRow;
  userId: string;
  companyId: string;
  visitId: string;
  action: VisitAction;
  reason: string;
}) {
  const { service, employee, userId, companyId, visitId, action, reason } = input;
  if (action === "reopen") {
    throw new Error("Completed Visit Reopen requires Supabase migration 202607270003_completed_visit_reopen_guard.sql.");
  }

  const current = await service
    .from("visits")
    .select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds")
    .eq("id", visitId)
    .or(companyFilter(companyId))
    .maybeSingle();

  if (current.error) throw new Error(current.error.message);
  const visit = current.data;
  if (!visit) throw new Error("Visit not found in this company.");

  const assigned = visit.assigned_employee_id === employee.id
    || (!visit.assigned_employee_id && Boolean(employee.crew_id) && visit.crew_id === employee.crew_id);
  if (!assigned) throw new Error("This Visit is not assigned to the authenticated Employee.");
  if (visit.scheduled_date !== torontoDateKey()) {
    throw new Error("Employees can change execution only for today in America/Toronto.");
  }

  const previousStatus = String(visit.status);
  const now = new Date();
  const nowIso = now.toISOString();
  let nextStatus = previousStatus;
  let patch: Record<string, unknown>;
  let auditAction = `visit.execution.${action}`;

  if (action === "start") {
    if (previousStatus !== "scheduled") throw new Error("Only an Open Visit can be started.");
    nextStatus = "in_progress";
    patch = { status: nextStatus, started_at: nowIso, finished_at: null, duration_seconds: null };
  } else if (action === "done") {
    if (previousStatus !== "in_progress" || !visit.started_at) {
      throw new Error("Start this Visit before finishing it.");
    }
    nextStatus = "completed";
    patch = {
      status: nextStatus,
      finished_at: nowIso,
      duration_seconds: elapsedSeconds(visit.started_at, now),
    };
  } else if (action === "skip") {
    if (!["scheduled", "in_progress"].includes(previousStatus)) {
      throw new Error("Only an Open or active Visit can be skipped.");
    }
    nextStatus = "missed";
    patch = {
      status: nextStatus,
      finished_at: nowIso,
      duration_seconds: visit.started_at ? elapsedSeconds(visit.started_at, now) : null,
    };
  } else {
    if (reason.length < 5) throw new Error("Reset requires a reason with at least 5 characters.");
    if (previousStatus === "completed") {
      throw new Error("Completed work requires the audited Reopen flow.");
    }
    if (previousStatus === "in_progress" && visit.started_at) {
      const ageSeconds = elapsedSeconds(visit.started_at, now);
      if (ageSeconds > 20 * 60) {
        throw new Error("Employee Reset is limited to the first 20 minutes. Ask Admin after that window.");
      }
    } else if (previousStatus !== "scheduled") {
      throw new Error("Reset is allowed only for an Open or active Visit.");
    }
    nextStatus = "scheduled";
    patch = { status: nextStatus, started_at: null, finished_at: null, duration_seconds: null };
    if (previousStatus === "scheduled") auditAction = "visit.execution.auto_repair";
  }

  const updated = await service
    .from("visits")
    .update(patch)
    .eq("id", visitId)
    .eq("status", previousStatus)
    .select("id,status,scheduled_date,started_at,finished_at,duration_seconds,route_id,route_order")
    .maybeSingle();

  if (updated.error) throw new Error(updated.error.message);
  if (!updated.data) throw new Error("This Visit changed on another device. Refresh and try again.");

  const audit = await service.from("activity_log").insert({
    organization_id: companyId,
    company_id: companyId,
    actor_profile_id: userId,
    action: auditAction,
    entity_type: "visit",
    entity_id: visitId,
    details: reason || `Employee ${action} transition.`,
    metadata: {
      visit_id: visitId,
      previous_status: previousStatus,
      next_status: nextStatus,
      fallback_transition: true,
    },
  });
  if (audit.error) console.error("employee-route-fallback-audit", audit.error);

  console.warn("employee-route-transition-fallback", {
    visitId,
    action,
    previousStatus,
    nextStatus,
    companyId,
  });

  return updated.data;
}

function executionTransitionConverged(action: VisitAction, visit: any) {
  if (!visit) return false;
  const status = String(visit.status || "");
  if (action === "start") {
    return status === "in_progress" && Boolean(visit.started_at) && !visit.finished_at;
  }
  if (action === "done") {
    return status === "completed"
      && Boolean(visit.started_at)
      && Boolean(visit.finished_at)
      && Number.isFinite(Number(visit.duration_seconds))
      && Number(visit.duration_seconds) >= 0;
  }
  if (action === "skip") return status === "missed";
  return status === "scheduled"
    && !visit.started_at
    && !visit.finished_at
    && visit.duration_seconds == null;
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
      executionIssueCount: payload.stops.filter((stop: any) => !stop.executionStateValid).length,
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
    const { service, user, employee, userId, companyId } = await requireEmployee(request);
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

    const action = String(body.action || "") as VisitAction;
    if (!["start", "done", "reset", "skip", "reopen"].includes(action)) {
      throw new Error("Choose a valid canonical Visit action.");
    }

    const reason = String(body.reason || "").trim();
    if (["reset", "reopen"].includes(action) && reason.length < 5) {
      throw new Error(`${action === "reset" ? "Reset" : "Reopen"} requires a reason with at least 5 characters.`);
    }

    // Reset is intentionally idempotent for an Open Visit. This lets the field app
    // clear a stale/local timer safely without creating a fake execution transition.
    if (action === "reset") {
      const currentReset = await service
        .from("visits")
        .select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds,route_id,route_order")
        .eq("id", visitId)
        .or(companyFilter(companyId))
        .maybeSingle();
      if (currentReset.error) throw new Error(currentReset.error.message);
      const currentVisit = currentReset.data;
      if (!currentVisit) throw new Error("Visit not found in this company.");
      const assigned = currentVisit.assigned_employee_id === employee.id
        || (!currentVisit.assigned_employee_id && Boolean(employee.crew_id) && currentVisit.crew_id === employee.crew_id);
      if (!assigned) throw new Error("This Visit is not assigned to the authenticated Employee.");
      if (currentVisit.status === "scheduled") {
        const repaired = await fallbackVisitTransition({ service, employee, userId, companyId, visitId, action, reason });
        return NextResponse.json({ visit: repaired, fallback: true, verified: true, idempotent: true });
      }
    }

    const result = await user.rpc("transition_visit_execution", {
      p_visit_id: visitId,
      p_action: action,
      p_reason: reason || null,
    });

    if (!result.error) {
      const verified = await service
        .from("visits")
        .select("id,status,scheduled_date,started_at,finished_at,duration_seconds,route_id,route_order")
        .eq("id", visitId)
        .or(companyFilter(companyId))
        .maybeSingle();
      if (verified.error) throw new Error(verified.error.message);
      if (executionTransitionConverged(action, verified.data)) {
        return NextResponse.json({ visit: verified.data, fallback: false, verified: true });
      }
      console.warn("employee-route-rpc-nonconvergent", {
        visitId,
        action,
        returned: result.data,
        storedStatus: verified.data?.status || null,
      });
    } else {
      console.warn("employee-route-rpc-fallback", { visitId, action, message: result.error.message });
    }

    // Authentication and assignment were already checked by this API. The service-side
    // transition is the compatibility path for an absent, stale or non-convergent RPC.
    // Returning success is forbidden until the stored Visit satisfies the invariant.
    const visit = await fallbackVisitTransition({
      service,
      employee,
      userId,
      companyId,
      visitId,
      action,
      reason,
    });
    if (!executionTransitionConverged(action, visit)) {
      throw new Error("The Visit transition did not converge in the canonical database.");
    }
    return NextResponse.json({ visit, fallback: true, verified: true });
  } catch (error) {
    console.error("employee-route-patch", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Visit could not be updated." },
      { status: 400 },
    );
  }
}
