import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/admin/routes/route";
import { listOperationalCompanyEmployees } from "@/lib/employees/operationalEmployeeDirectory";
import { listOperationalCompanyCustomers, type OperationalJob } from "@/lib/customers/operationalCustomerDirectory";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational directory is not configured.");
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

async function companyContext(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await service.from("profiles")
    .select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can load operational records.");
  }
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, user: userClient(token), companyId };
}

async function ensureCustomerJobs(service: any, companyId: string) {
  const context = await listOperationalCompanyCustomers(service, companyId, { repair: true });
  const jobByProperty = new Map(context.jobs.map(job => [job.property_id, job]));
  for (const property of context.properties) {
    if (jobByProperty.has(property.id)) continue;
    const inserted = await service.from("jobs").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: property.customer_id,
      property_id: property.id,
      service_name: property.property_notes?.split("\n")[0]?.replace(/^Service type:\s*/i, "") || "Property Service",
      frequency: "one_time",
      active: true,
      next_visit_date: null,
    }).select("id,customer_id,property_id,quote_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,company_id,organization_id,active,created_at").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Missing customer Job could not be repaired.");
    context.jobs.push(inserted.data as OperationalJob);
    jobByProperty.set(property.id, inserted.data as OperationalJob);
  }
  return context;
}

async function canonicalJobs(service: any, user: any, companyId: string) {
  const context = await ensureCustomerJobs(service, companyId);
  const assignmentResult = await user.rpc("get_company_dispatch_jobs");
  const assignments = new Map<string, any>();
  if (!assignmentResult.error && Array.isArray(assignmentResult.data)) {
    for (const row of assignmentResult.data) {
      const id = row.id || row.jobId;
      if (id) assignments.set(String(id), row);
    }
  }
  const customers = new Map(context.customers.map(customer => [customer.id, customer]));
  const properties = new Map(context.properties.map(property => [property.id, property]));
  return {
    repairedCustomerIds: context.repairedCustomerIds,
    jobs: context.jobs.map(job => {
      const customer = customers.get(job.customer_id);
      const property = properties.get(job.property_id);
      const assignment = assignments.get(job.id);
      return {
        id: job.id,
        serviceName: job.service_name || "Property Service",
        frequency: job.frequency || "one_time",
        nextVisitDate: job.next_visit_date || null,
        customerName: customer?.full_name || "Customer",
        address: property
          ? [property.address_line1, property.city, property.province, property.postal_code].filter(Boolean).join(", ")
          : "Address missing",
        propertyId: job.property_id,
        customerId: job.customer_id,
        quoteId: job.quote_id,
        crewId: assignment?.crewId || assignment?.crew_id || null,
        crewName: assignment?.crewName || assignment?.crew_name || null,
        recurrenceAnchorDate: assignment?.recurrenceAnchorDate || assignment?.recurrence_anchor_date || job.recurrence_anchor_date || null,
        defaultRouteOrder: assignment?.defaultRouteOrder ?? assignment?.default_route_order ?? job.default_route_order ?? null,
        createdAt: job.created_at,
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const [{ service, user, companyId }, legacyResponse] = await Promise.all([
      companyContext(request),
      legacyGet(request),
    ]);
    const payload = await legacyResponse.json();
    if (!legacyResponse.ok) return NextResponse.json(payload, { status: legacyResponse.status });

    const [employees, customerJobs] = await Promise.all([
      listOperationalCompanyEmployees(service, companyId),
      canonicalJobs(service, user, companyId),
    ]);
    const employeeIds = new Set(employees.map(employee => employee.employeeId));
    const crewIds = new Set(employees.map(employee => employee.crewId));
    const previousIssues = Array.isArray(payload.health?.issues) ? payload.health.issues : [];
    const issues = previousIssues.filter((issue: any) => {
      const missing = Array.isArray(issue?.missing) ? issue.missing : [];
      if (!missing.includes("inactiveEmployeeId") && !missing.includes("inactiveCrewId")) return true;
      const visit = (payload.board?.visits || []).find((item: any) => item.id === issue.visitId);
      if (!visit) return true;
      return (visit.employeeId && !employeeIds.has(visit.employeeId))
        || (visit.crewId && !crewIds.has(visit.crewId));
    });
    const unscheduledJobs = customerJobs.jobs.filter(job => !job.crewId);
    const assignedJobs = customerJobs.jobs.filter(job => Boolean(job.crewId));

    console.info("admin-routes-global-ok", {
      companyId,
      employeeCount: employees.length,
      jobCount: customerJobs.jobs.length,
      repairedCustomerCount: customerJobs.repairedCustomerIds.length,
    });

    return NextResponse.json({
      ...payload,
      employees,
      employeeDirectorySource: "profiles+employees",
      customerDirectorySource: "canonical-company-customer-directory",
      repairedCustomerIds: customerJobs.repairedCustomerIds,
      health: { ...(payload.health || {}), healthy: issues.length === 0, issueCount: issues.length, issues },
      board: {
        ...(payload.board || {}),
        crews: employees.map(employee => ({ id: employee.crewId, name: employee.name, active: true, createdAt: "" })),
        unscheduledJobs,
        assignedJobs,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operational records could not be loaded." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  return legacyPost(request);
}
