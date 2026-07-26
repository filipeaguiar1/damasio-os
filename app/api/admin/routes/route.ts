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
  return { service, user: userClient(token), companyId };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Route request failed." },
    { status },
  );
}

async function ensureEmployees(service: any, companyId: string) {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id,full_name,email,address_line1,route_start_address,active")
    .eq("role", "employee")
    .eq("active", true)
    .or(companyFilter(companyId))
    .order("full_name");
  if (error) throw new Error(error.message);

  const { data: rows, error: employeeError } = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
    .eq("active", true)
    .or(companyFilter(companyId));
  if (employeeError) throw new Error(employeeError.message);

  const byProfile = new Map<string, any>();
  for (const row of rows || []) if (row.profile_id) byProfile.set(row.profile_id, row);

  const result: any[] = [];
  for (const profile of profiles || []) {
    let employee = byProfile.get(profile.id);
    if (!employee) {
      const created = await service
        .from("employees")
        .insert({
          company_id: companyId,
          organization_id: companyId,
          profile_id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          address_line1: profile.address_line1,
          route_start_address: profile.route_start_address || profile.address_line1,
          active: true,
          invite_status: "sent",
        })
        .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
        .single();
      if (created.error) throw new Error(created.error.message);
      employee = created.data;
    }

    if (!employee.crew_id) {
      const crew = await service
        .from("crews")
        .insert({
          company_id: companyId,
          organization_id: companyId,
          name: employee.full_name || profile.full_name || "Employee route",
          active: true,
        })
        .select("id")
        .single();
      if (crew.error) throw new Error(crew.error.message);

      const linked = await service.from("employees").update({ crew_id: crew.data.id }).eq("id", employee.id);
      if (linked.error) throw new Error(linked.error.message);
      employee.crew_id = crew.data.id;
    }

    result.push({
      id: profile.id,
      profileId: profile.id,
      employeeId: employee.id,
      crewId: employee.crew_id,
      name: profile.full_name || employee.full_name || "Employee",
      email: profile.email || employee.email || "",
      routeStartAddress:
        profile.route_start_address ||
        profile.address_line1 ||
        employee.route_start_address ||
        employee.address_line1 ||
        null,
    });
  }

  return result;
}

async function canonicalJobs(service: any, user: any, companyId: string) {
  const customersResult = await service
    .from("customers")
    .select("id,full_name,assignment_status,offer_status,service_company_id,company_id,organization_id,archived_at")
    .is("archived_at", null)
    .or(`service_company_id.eq.${companyId},${companyFilter(companyId)}`);
  if (customersResult.error) throw new Error(customersResult.error.message);

  const customers = (customersResult.data || []).filter((customer: any) =>
    customer.offer_status === "accepted" ||
    ["accepted", "assigned", "active"].includes(customer.assignment_status));
  const customerIds = customers.map((item: any) => item.id);
  if (!customerIds.length) return [];

  const propertyResult = await service
    .from("properties")
    .select("id,customer_id,address_line1,city,province,postal_code,property_notes")
    .in("customer_id", customerIds);
  if (propertyResult.error) throw new Error(propertyResult.error.message);
  const properties = propertyResult.data || [];

  const jobsResult = await service
    .from("jobs")
    .select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active")
    .eq("active", true)
    .or(companyFilter(companyId));
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const jobs = jobsResult.data || [];

  const jobByProperty = new Map<string, any>();
  for (const job of jobs) if (job.property_id && !jobByProperty.has(job.property_id)) jobByProperty.set(job.property_id, job);

  for (const property of properties) {
    if (!property.id || jobByProperty.has(property.id)) continue;
    const inserted = await service
      .from("jobs")
      .insert({
        organization_id: companyId,
        company_id: companyId,
        customer_id: property.customer_id,
        property_id: property.id,
        service_name: property.property_notes?.split("\n")[0]?.replace(/^Service type:\s*/i, "") || "Property Service",
        frequency: "one_time",
        active: true,
      })
      .select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    jobs.push(inserted.data);
    jobByProperty.set(property.id, inserted.data);
  }

  const assignmentByJob = new Map<string, {
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
      assignmentByJob.set(id, {
        crewId: row.crewId || row.crew_id || null,
        crewName: row.crewName || row.crew_name || null,
        routeOrder: row.defaultRouteOrder ?? row.default_route_order ?? null,
        routeDate: row.recurrenceAnchorDate || row.recurrence_anchor_date || null,
      });
    }
  }

  const customerNames = new Map(customers.map((item: any) => [item.id, item.full_name]));
  const propertyById = new Map(properties.map((item: any) => [item.id, item]));

  return jobs.map((job: any) => {
    const property: any = propertyById.get(job.property_id);
    const assignment = assignmentByJob.get(job.id);
    return {
      id: job.id,
      serviceName: job.service_name || "Property Service",
      frequency: job.frequency || "one_time",
      nextVisitDate: job.next_visit_date || null,
      customerName: customerNames.get(job.customer_id) || "Customer",
      address: property
        ? [property.address_line1, property.city, property.province, property.postal_code].filter(Boolean).join(", ")
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

async function canonicalVisits(service: any, companyId: string) {
  const result = await service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,route_order,started_at,finished_at,duration_seconds,created_at,customers(full_name),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")
    .or(companyFilter(companyId))
    .neq("status", "cancelled")
    .order("scheduled_date", { ascending: false })
    .order("route_order", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (result.error) throw new Error(result.error.message);

  return (result.data || []).map((row: any) => {
    const employee = (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    return {
      id: row.id,
      jobId: row.job_id,
      routeId: row.route_id,
      crewId: row.crew_id,
      crewName: employee,
      employeeId: row.assigned_employee_id,
      employeeName: employee,
      customerId: row.customer_id,
      customerName: (Array.isArray(row.customers) ? row.customers[0] : row.customers)?.full_name || null,
      propertyId: row.property_id,
      address: [property?.address_line1, property?.city, property?.province, property?.postal_code].filter(Boolean).join(", "),
      serviceName: (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs)?.service_name || "Property Service",
      scheduledDate: row.scheduled_date,
      status: row.status,
      routeOrder: row.route_order,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at,
    };
  });
}

function canonicalHealth(employees: any[], visits: any[]) {
  const activeEmployeeIds = new Set(employees.map(employee => employee.employeeId).filter(Boolean));
  const activeCrewIds = new Set(employees.map(employee => employee.crewId).filter(Boolean));
  const issues = visits.flatMap(visit => {
    const missing = [
      !visit.customerId && "customerId",
      !visit.propertyId && "propertyId",
      !visit.jobId && "jobId",
      !visit.id && "visitId",
      !visit.routeId && "routeId",
      !visit.employeeId && "employeeId",
      !visit.crewId && "crewId",
      visit.employeeId && !activeEmployeeIds.has(visit.employeeId) && "inactiveEmployeeId",
      visit.crewId && !activeCrewIds.has(visit.crewId) && "inactiveCrewId",
    ].filter(Boolean);
    return missing.length ? [{ visitId: visit.id, missing }] : [];
  });

  return {
    healthy: issues.length === 0,
    issueCount: issues.length,
    issues,
  };
}

async function resolveRouteEmployee(service: any, companyId: string, employeeId: string | undefined, crewId: string) {
  let query = service
    .from("employees")
    .select("id,crew_id,full_name")
    .eq("active", true)
    .or(companyFilter(companyId));
  query = employeeId ? query.eq("id", employeeId) : query.eq("crew_id", crewId);

  const result = await query.limit(2);
  if (result.error) throw new Error(result.error.message);
  if ((result.data || []).length !== 1) {
    throw new Error("The selected route must resolve to exactly one active Employee.");
  }
  return result.data[0];
}

async function publishEmployeeRoute(
  service: any,
  companyId: string,
  employeeId: string | undefined,
  crewId: string,
  routeDate: string,
  jobIds: string[],
) {
  const employee = await resolveRouteEmployee(service, companyId, employeeId, crewId);
  const canonicalCrewId = employee.crew_id || crewId;
  if (!canonicalCrewId) throw new Error("The selected Employee has no route crew.");

  const jobsResult = await service
    .from("jobs")
    .select("id,customer_id,property_id")
    .in("id", jobIds)
    .eq("active", true)
    .or(companyFilter(companyId));
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const jobs = jobsResult.data || [];
  if (jobs.length !== jobIds.length) {
    throw new Error("One or more selected customer jobs are no longer available. Refresh and try again.");
  }

  const incompleteJob = jobs.find((job: any) => !job.customer_id || !job.property_id);
  if (incompleteJob) throw new Error(`Job ${incompleteJob.id} is missing its canonical Customer or Property link.`);

  const existing = await service
    .from("routes")
    .select("id")
    .eq("crew_id", canonicalCrewId)
    .eq("route_date", routeDate)
    .or(companyFilter(companyId))
    .order("created_at")
    .limit(2);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data || []).length > 1) {
    throw new Error("More than one canonical Route exists for this Employee and date. Repair the duplicate before publishing.");
  }

  let routeId: string | null = existing.data?.[0]?.id || null;
  if (!routeId) {
    const created = await service
      .from("routes")
      .insert({
        organization_id: companyId,
        company_id: companyId,
        crew_id: canonicalCrewId,
        route_date: routeDate,
        status: "published",
      })
      .select("id")
      .single();
    if (created.error) throw new Error(created.error.message);
    routeId = created.data.id;
  } else {
    const updatedRoute = await service.from("routes").update({ status: "published" }).eq("id", routeId);
    if (updatedRoute.error) throw new Error(updatedRoute.error.message);
  }

  for (let index = 0; index < jobIds.length; index++) {
    const job = jobs.find((item: any) => item.id === jobIds[index]);
    const existingVisits = await service
      .from("visits")
      .select("id,status,created_at")
      .eq("job_id", job.id)
      .eq("scheduled_date", routeDate)
      .or(companyFilter(companyId))
      .order("created_at", { ascending: true });
    if (existingVisits.error) throw new Error(existingVisits.error.message);

    const current = (existingVisits.data || []).find((visit: any) => visit.status !== "cancelled");
    const visitPatch = {
      route_id: routeId,
      crew_id: canonicalCrewId,
      assigned_employee_id: employee.id,
      customer_id: job.customer_id,
      property_id: job.property_id,
      scheduled_date: routeDate,
      route_order: index + 1,
      status: "scheduled",
    };

    if (current?.id) {
      const updated = await service.from("visits").update(visitPatch).eq("id", current.id);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await service.from("visits").insert({
        organization_id: companyId,
        company_id: companyId,
        job_id: job.id,
        ...visitPatch,
      });
      if (inserted.error) throw new Error(inserted.error.message);
    }

    const updatedJob = await service
      .from("jobs")
      .update({
        next_visit_date: routeDate,
        recurrence_anchor_date: routeDate,
        default_route_order: index + 1,
      })
      .eq("id", job.id)
      .or(companyFilter(companyId));
    if (updatedJob.error) throw new Error(updatedJob.error.message);
  }

  const verification = await service
    .from("visits")
    .select("id,job_id,route_id,assigned_employee_id,crew_id,customer_id,property_id,scheduled_date,route_order")
    .in("job_id", jobIds)
    .eq("scheduled_date", routeDate)
    .eq("assigned_employee_id", employee.id)
    .neq("status", "cancelled");
  if (verification.error) throw new Error(verification.error.message);

  const savedVisits = verification.data || [];
  if (savedVisits.length !== jobIds.length) {
    throw new Error("The route was not fully saved. No success confirmation was issued.");
  }
  const invalidVisit = savedVisits.find((visit: any) =>
    !visit.route_id ||
    visit.route_id !== routeId ||
    !visit.customer_id ||
    !visit.property_id ||
    !visit.job_id ||
    !visit.assigned_employee_id ||
    !visit.crew_id ||
    !visit.route_order);
  if (invalidVisit) {
    throw new Error(`Visit ${invalidVisit.id} failed the canonical route verification.`);
  }

  return {
    saved: true,
    count: jobIds.length,
    action: "smart",
    routeId,
    employeeId: employee.id,
    employeeName: employee.full_name,
    visits: savedVisits,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const [employees, jobs, visits] = await Promise.all([
      ensureEmployees(service, companyId),
      canonicalJobs(service, user, companyId),
      canonicalVisits(service, companyId),
    ]);
    const health = canonicalHealth(employees, visits);

    console.info("admin-routes-get-ok", {
      companyId,
      employeeCount: employees.length,
      jobCount: jobs.length,
      visitCount: visits.length,
      canonicalIssueCount: health.issueCount,
      issueVisitIds: health.issues.map((issue: any) => issue.visitId),
    });

    return NextResponse.json({
      employees,
      health,
      board: {
        crews: employees.map((employee: any) => ({
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
    console.error("admin-routes-get", error);
    return fail(error, 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, user, companyId } = await requireAdmin(request);
    const body = await request.json() as {
      action?: "assign" | "unassign" | "smart" | "move";
      jobIds?: string[];
      employeeId?: string;
      crewId?: string;
      routeDate?: string;
    };
    const jobIds = [...new Set((body.jobIds || []).filter(Boolean))];
    if (!jobIds.length) throw new Error("Select at least one customer.");

    const action = body.action || "assign";
    if (action === "unassign") {
      for (const jobId of jobIds) {
        const result = await user.rpc("assign_job_to_crew", { p_job_id: jobId, p_crew_id: null });
        if (result.error) throw new Error(result.error.message);
      }
      return NextResponse.json({ saved: true, count: jobIds.length, action });
    }

    if (!body.crewId) throw new Error("Select an Employee.");
    if (action === "assign") {
      for (const jobId of jobIds) {
        const result = await user.rpc("assign_job_to_crew", { p_job_id: jobId, p_crew_id: body.crewId });
        if (result.error) throw new Error(result.error.message);
      }
      return NextResponse.json({ saved: true, count: jobIds.length, action });
    }

    if (!body.routeDate) throw new Error("Select a route date.");
    return NextResponse.json(await publishEmployeeRoute(
      service,
      companyId,
      body.employeeId,
      body.crewId,
      body.routeDate,
      jobIds,
    ));
  } catch (error) {
    console.error("admin-routes-post", error);
    return fail(error);
  }
}
