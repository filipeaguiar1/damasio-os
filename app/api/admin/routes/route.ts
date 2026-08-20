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

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function fail(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Route request failed." },
    { status },
  );
}

function missingMigration(message?: string) {
  return /publish_canonical_route|schema cache|could not find the function/i.test(message || "");
}

function isDemoLabel(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return /^demo(?:[\s._+-]*\d+)?$/.test(normalized)
    || /^demo(?:[._+-]?\d*)?@/.test(normalized)
    || normalized.endsWith("@example.com");
}

function isDemoIdentity(profile: any, employee?: any) {
  return isDemoLabel(profile?.full_name)
    || isDemoLabel(profile?.email)
    || isDemoLabel(employee?.full_name)
    || isDemoLabel(employee?.email);
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
    throw new Error("Only an active company Admin can manage routes.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");

  return {
    service,
    user: userClient(token),
    companyId,
  };
}

async function readEmployees(service: any, companyId: string) {
  const profilesResult = await service
    .from("profiles")
    .select("id,full_name,email,address_line1,route_start_address,active")
    .eq("role", "employee")
    .eq("active", true)
    .or(companyFilter(companyId))
    .order("full_name");

  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const employeeResult = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active,created_at")
    .eq("active", true)
    .or(companyFilter(companyId))
    .order("created_at", { ascending: false });

  if (employeeResult.error) throw new Error(employeeResult.error.message);

  const byProfile = new Map<string, any[]>();
  for (const row of employeeResult.data || []) {
    if (!row.profile_id) continue;
    const aliases = byProfile.get(String(row.profile_id)) || [];
    aliases.push(row);
    byProfile.set(String(row.profile_id), aliases);
  }

  const employees: any[] = [];
  for (const profile of profilesResult.data || []) {
    let aliases = byProfile.get(String(profile.id)) || [];
    let employee = aliases[0] || null;

    // Old demo logins must never become operational Employees, Crews or Route markers.
    if (isDemoIdentity(profile, employee)) continue;

    // GET is a read model. Employee/Crew creation belongs to the explicit lifecycle flow.
    if (!employee || !employee.crew_id) continue;

    const employeeIds = [...new Set(
      [...aliases.map(alias => String(alias.id || "")), String(employee.id || "")].filter(Boolean),
    )];
    const crewIds = [...new Set(
      [...aliases.map(alias => String(alias.crew_id || "")), String(employee.crew_id || "")].filter(Boolean),
    )];

    employees.push({
      id: profile.id,
      profileId: profile.id,
      employeeId: employee.id,
      crewId: employee.crew_id,
      employeeIds,
      crewIds,
      name: profile.full_name || employee.full_name || "Employee",
      email: profile.email || employee.email || "",
      routeStartAddress:
        profile.route_start_address
        || profile.address_line1
        || employee.route_start_address
        || employee.address_line1
        || null,
    });
  }

  return employees;
}

async function canonicalJobs(service: any, user: any, companyId: string) {
  const customerResult = await service
    .from("customers")
    .select("id,full_name,assignment_status,offer_status,service_company_id,company_id,organization_id,archived_at")
    .is("archived_at", null)
    .or(`service_company_id.eq.${companyId},${companyFilter(companyId)}`);

  if (customerResult.error) throw new Error(customerResult.error.message);

  const customers = (customerResult.data || []).filter((customer: any) =>
    customer.offer_status === "accepted"
    || ["accepted", "assigned", "active"].includes(customer.assignment_status));
  const customerIds = customers.map((customer: any) => customer.id);
  if (!customerIds.length) return [] as any[];

  const propertyResult = await service
    .from("properties")
    .select("id,customer_id,address_line1,city,province,postal_code,property_notes")
    .in("customer_id", customerIds)
    .or(companyFilter(companyId));

  if (propertyResult.error) throw new Error(propertyResult.error.message);
  const properties = propertyResult.data || [];

  const jobResult = await service
    .from("jobs")
    .select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active")
    .eq("active", true)
    .or(companyFilter(companyId));

  if (jobResult.error) throw new Error(jobResult.error.message);
  const jobs = jobResult.data || [];

  const assignments = new Map<string, {
    crewId: string | null;
    crewName: string | null;
    routeOrder: number | null;
    routeDate: string | null;
  }>();

  const assignmentResult = await user.rpc("get_company_dispatch_jobs");
  if (!assignmentResult.error && Array.isArray(assignmentResult.data)) {
    for (const row of assignmentResult.data) {
      const id = row.id || row.jobId;
      if (!id) continue;
      const crewName = row.crewName || row.crew_name || null;

      // Treat legacy Demo 02/04 assignments as unassigned so a real Employee can take the Job.
      if (isDemoLabel(crewName)) continue;

      assignments.set(id, {
        crewId: row.crewId || row.crew_id || null,
        crewName,
        routeOrder: row.defaultRouteOrder ?? row.default_route_order ?? null,
        routeDate: row.recurrenceAnchorDate || row.recurrence_anchor_date || null,
      });
    }
  }

  const customerNames = new Map(customers.map((customer: any) => [customer.id, customer.full_name]));
  const propertyById = new Map(properties.map((property: any) => [property.id, property]));

  return jobs.map((job: any) => {
    const property: any = propertyById.get(job.property_id);
    const assignment = assignments.get(job.id);
    return {
      id: job.id,
      serviceName: job.service_name || "Property Service",
      frequency: job.frequency || "one_time",
      nextVisitDate: job.next_visit_date || null,
      customerName: customerNames.get(job.customer_id) || "Customer",
      address: property
        ? [property.address_line1, property.city, property.province, property.postal_code]
          .filter(Boolean)
          .join(", ")
        : "Address missing",
      propertyId: job.property_id,
      customerId: job.customer_id,
      quoteId: null,
      crewId: assignment?.crewId || null,
      crewName: assignment?.crewName || null,
      recurrenceAnchorDate: assignment?.routeDate || job.recurrence_anchor_date || null,
      defaultRouteOrder: assignment?.routeOrder ?? job.default_route_order ?? null,
      createdAt: job.created_at,
    };
  });
}

async function canonicalVisits(service: any, companyId: string, routeDate?: string | null) {
  let routeQuery = service
    .from("routes")
    .select("id,crew_id,route_date,created_at")
    .or(companyFilter(companyId));

  if (routeDate) routeQuery = routeQuery.eq("route_date", routeDate);

  const routesResult = await routeQuery
    .order("route_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(routeDate ? 250 : 100);
  if (routesResult.error) throw new Error(routesResult.error.message);

  const routes: any[] = routesResult.data || [];
  const routeIds = routes.map((route: any) => String(route.id));
  if (!routeIds.length) return [] as any[];

  const batches = <T,>(values: T[], size = 20) => {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  };

  // Keep canonical reads bounded. Large histories previously launched every batch at once,
  // making nested Visit reads compete for the same Postgres statement budget.
  const stopResults: any[] = [];
  for (const ids of batches(routeIds)) {
    const result = await service
      .from("route_stops")
      .select("route_id,visit_id,position")
      .in("route_id", ids)
      .order("position", { ascending: true });
    if (result.error) throw new Error(result.error.message);
    stopResults.push(result);
  }

  const stopRows: any[] = stopResults.flatMap(result => result.data || []);
  const visitIds = [...new Set(stopRows.map((row: any) => String(row.visit_id)).filter(Boolean))];
  if (!visitIds.length) return [] as any[];

  const visitResults: any[] = [];
  for (const ids of batches(visitIds)) {
    const result = await service
      .from("visits")
      .select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,started_at,finished_at,duration_seconds,created_at,customers(full_name,email,notes,archived_at),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")
      .in("id", ids)
      .or(companyFilter(companyId));
    if (result.error) throw new Error(result.error.message);
    visitResults.push(result);
  }

  const visits = new Map<string, any>();
  for (const result of visitResults) {
    for (const row of result.data || []) visits.set(String(row.id), row);
  }
  const routeById = new Map<string, any>(routes.map((route: any) => [String(route.id), route]));
  const candidatesByRoute = new Map<string, any[]>();

  for (const stop of stopRows) {
    const routeId = String(stop.route_id);
    const row = visits.get(String(stop.visit_id)) || null;
    const employee = row
      ? (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null
      : null;
    const customer = row ? (Array.isArray(row.customers) ? row.customers[0] : row.customers) : null;
    const property = row ? (Array.isArray(row.properties) ? row.properties[0] : row.properties) : null;
    const route: any = routeById.get(routeId);
    const candidate = {
      routeId,
      position: Number(stop.position),
      missingVisit: !row,
      cancelled: row?.status === "cancelled",
      archived: Boolean(customer?.archived_at),
      demo: isDemoLabel(employee),
      visit: row ? {
        id: row.id,
        jobId: row.job_id,
        routeId,
        crewId: row.crew_id || route?.crew_id || null,
        crewName: employee,
        employeeId: row.assigned_employee_id,
        employeeName: employee,
        customerId: row.customer_id,
        customerName: customer?.full_name || null,
        propertyId: row.property_id,
        address: [
          property?.address_line1,
          property?.city,
          property?.province,
          property?.postal_code,
        ].filter(Boolean).join(", "),
        serviceName: (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs)?.service_name || "Property Service",
        scheduledDate: row.scheduled_date || route?.route_date || null,
        status: row.status,
        routeOrder: Number(stop.position),
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
      } : null,
    };
    const current = candidatesByRoute.get(routeId) || [];
    current.push(candidate);
    candidatesByRoute.set(routeId, current);
  }

  const canonical: any[] = [];
  for (const [id, candidates] of candidatesByRoute) {
    candidates.sort((left, right) => left.position - right.position);
    const positionsValid = candidates.every((candidate, index) => candidate.position === index + 1);
    const hasBrokenVisit = candidates.some(candidate => candidate.missingVisit || candidate.cancelled);
    const allArchived = candidates.length > 0 && candidates.every(candidate => candidate.archived);
    const allDemo = candidates.length > 0 && candidates.every(candidate => candidate.demo);
    const mixedRetired = candidates.some(candidate => candidate.archived || candidate.demo);

    if (allArchived || allDemo) continue;

    if (!positionsValid || hasBrokenVisit || mixedRetired) {
      const reason = !positionsValid
        ? "positions are not sequential"
        : hasBrokenVisit
          ? "a route_stop references a missing or cancelled Visit"
          : "active and retired identities are mixed";
      if (routeDate) throw new Error(`Canonical Route ${id} is invalid: ${reason}.`);
      console.warn("admin-routes-skip-stale-route", { routeId: id, reason });
      continue;
    }

    canonical.push(...candidates.map(candidate => candidate.visit));
  }

  return canonical.sort((left, right) =>
    String(right.scheduledDate || "").localeCompare(String(left.scheduledDate || ""))
    || String(left.routeId).localeCompare(String(right.routeId))
    || left.routeOrder - right.routeOrder);
}

function canonicalHealth(employees: any[], visits: any[]) {
  const employeeIds = new Set(employees.flatMap(employee =>
    employee.employeeIds?.length ? employee.employeeIds : [employee.employeeId]).filter(Boolean));
  const crewIds = new Set(employees.flatMap(employee =>
    employee.crewIds?.length ? employee.crewIds : [employee.crewId]).filter(Boolean));
  const issues = visits.flatMap(visit => {
    const missing = [
      !visit.customerId && "customerId",
      !visit.propertyId && "propertyId",
      !visit.jobId && "jobId",
      !visit.id && "visitId",
      visit.routeId && !visit.employeeId && "employeeId",
      visit.routeId && !visit.crewId && "crewId",
      visit.employeeId && !employeeIds.has(visit.employeeId) && "inactiveEmployeeId",
      visit.crewId && !crewIds.has(visit.crewId) && "inactiveCrewId",
    ].filter(Boolean);
    return missing.length ? [{ visitId: visit.id, missing }] : [];
  });

  return {
    healthy: issues.length === 0,
    issueCount: issues.length,
    issues,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const routeDate = request.nextUrl.searchParams.get("date")?.trim() || null;

    // Each read below already fans out into several Supabase requests. Running all three
    // simultaneously caused upstream statement timeouts under route/simulator load, so keep
    // the read model serialized without changing any canonical Route/Visit semantics.
    const employees = await readEmployees(service, companyId);
    const jobs = await canonicalJobs(service, user, companyId);
    const visits = await canonicalVisits(service, companyId, routeDate);
    const health = canonicalHealth(employees, visits);

    console.info("admin-routes-get-ok", {
      companyId,
      employeeCount: employees.length,
      jobCount: jobs.length,
      visitCount: visits.length,
      canonicalIssueCount: health.issueCount,
    });

    return NextResponse.json({
      employees,
      health,
      board: {
        crews: employees.map(employee => ({
          id: employee.crewId,
          name: employee.name,
          active: true,
          createdAt: "",
        })),
        unscheduledJobs: jobs.filter((job: any) => !job.crewId),
        assignedJobs: jobs.filter((job: any) => Boolean(job.crewId)),
        visits,
        tasks: [],
        activity: [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route request failed.";
    const status = /sign in|session expired|only an active company admin/i.test(message) ? 401 : 500;
    console.error("admin-routes-get", error);
    return fail(error, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const body = await request.json() as {
      action?: "assign" | "unassign" | "smart" | "move";
      jobIds?: string[];
      employeeId?: string;
      crewId?: string;
      routeDate?: string;
    };

    const jobIds = [...new Set((body.jobIds || []).map(String).filter(Boolean))];
    if (!jobIds.length) throw new Error("Select at least one canonical Job.");

    const action = body.action || "assign";
    if (action === "assign" || action === "unassign") {
      const crewId = action === "unassign" ? null : String(body.crewId || "");
      if (action === "assign" && !crewId) throw new Error("Select an Employee.");

      for (const jobId of jobIds) {
        const result = await user.rpc("assign_job_to_crew", {
          p_job_id: jobId,
          p_crew_id: crewId,
        });
        if (result.error) throw new Error(result.error.message);
      }
      return NextResponse.json({ saved: true, count: jobIds.length, action });
    }

    const employeeId = String(body.employeeId || "");
    const crewId = String(body.crewId || "");
    const routeDate = String(body.routeDate || "");
    if (!employeeId || !crewId || !routeDate) {
      throw new Error("Employee, Crew and route date are required.");
    }

    const result = await user.rpc("publish_canonical_route", {
      p_employee_id: employeeId,
      p_crew_id: crewId,
      p_route_date: routeDate,
      p_ordered_job_ids: jobIds,
      p_source_visit_ids: [],
    });

    if (result.error) {
      if (missingMigration(result.error.message)) {
        throw new Error("Supabase migration 202607270003_completed_visit_reopen_guard.sql is pending or not confirmed.");
      }
      throw new Error(result.error.message);
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("admin-routes-post", error);
    return fail(error);
  }
}