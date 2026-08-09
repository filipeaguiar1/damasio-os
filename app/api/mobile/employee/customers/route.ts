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
  if (!url || !key) throw new Error("Employee customer portfolio is not configured.");
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

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function requireEmployee(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");

  const user = userClient(token);
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Employee login expired. Sign in again.");

  const service = serviceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,avatar_url")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "employee") {
    throw new Error("This login is not an active Employee account.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This Employee profile is not linked to a company.");

  const { data: employee, error: employeeError } = await service
    .from("employees")
    .select("id,profile_id,company_id,organization_id,full_name,email,crew_id,active")
    .eq("profile_id", auth.user.id)
    .eq("active", true)
    .or(companyFilter(companyId))
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee) throw new Error("No canonical Employee ID is linked to this login.");

  return {
    service,
    user,
    companyId,
    employee: employee as EmployeeRow,
    avatarUrl: profile.avatar_url || null,
  };
}

function normalizeDispatchRow(row: any) {
  return {
    jobId: String(row?.id || row?.jobId || ""),
    customerId: row?.customerId || row?.customer_id || null,
    propertyId: row?.propertyId || row?.property_id || null,
    crewId: row?.crewId || row?.crew_id || null,
    serviceName: row?.serviceName || row?.service_name || null,
    frequency: row?.frequency || null,
    nextVisitDate: row?.nextVisitDate || row?.next_visit_date || null,
  };
}

async function ownedJobIdsFromLatestVisits(service: any, employee: EmployeeRow, companyId: string) {
  const result = await service
    .from("visits")
    .select("id,job_id,property_id,assigned_employee_id,crew_id,scheduled_date,created_at,status")
    .neq("status", "cancelled")
    .or(companyFilter(companyId))
    .order("scheduled_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);

  const latestByProperty = new Map<string, any>();
  for (const visit of result.data || []) {
    if (!visit.property_id || latestByProperty.has(String(visit.property_id))) continue;
    latestByProperty.set(String(visit.property_id), visit);
  }

  return unique([...latestByProperty.values()]
    .filter((visit: any) => visit.assigned_employee_id === employee.id
      || (!visit.assigned_employee_id && employee.crew_id && visit.crew_id === employee.crew_id))
    .map((visit: any) => visit.job_id));
}

export async function GET(request: NextRequest) {
  try {
    const { service, user, companyId, employee, avatarUrl } = await requireEmployee(request);

    let ownedJobIds: string[] = [];
    let dispatchRows = new Map<string, ReturnType<typeof normalizeDispatchRow>>();
    const dispatch = await user.rpc("get_company_dispatch_jobs");
    if (!dispatch.error && Array.isArray(dispatch.data)) {
      const owned = dispatch.data
        .map(normalizeDispatchRow)
        .filter(row => Boolean(row.jobId) && Boolean(employee.crew_id) && row.crewId === employee.crew_id);
      ownedJobIds = unique(owned.map(row => row.jobId));
      dispatchRows = new Map(owned.map(row => [row.jobId, row]));
    } else {
      ownedJobIds = await ownedJobIdsFromLatestVisits(service, employee, companyId);
    }

    if (!ownedJobIds.length) {
      return NextResponse.json({
        employee: { id: employee.id, name: employee.full_name || "Employee", avatarUrl },
        properties: [],
      });
    }

    const jobsResult = await service
      .from("jobs")
      .select("id,customer_id,property_id,service_name,frequency,next_visit_date,created_at,active")
      .in("id", ownedJobIds)
      .eq("active", true)
      .or(companyFilter(companyId));
    if (jobsResult.error) throw new Error(jobsResult.error.message);

    const jobs = jobsResult.data || [];
    const propertyIds = unique(jobs.map((job: any) => job.property_id));
    const customerIds = unique(jobs.map((job: any) => job.customer_id));
    const empty = Promise.resolve({ data: [] as any[], error: null });

    const [propertiesResult, customersResult] = await Promise.all([
      propertyIds.length
        ? service
          .from("properties")
          .select("id,customer_id,official_photo_url,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes")
          .in("id", propertyIds)
          .or(companyFilter(companyId))
        : empty,
      customerIds.length
        ? service
          .from("customers")
          .select("id,full_name")
          .in("id", customerIds)
          .or(companyFilter(companyId))
        : empty,
    ]);
    if (propertiesResult.error) throw new Error(propertiesResult.error.message);
    if (customersResult.error) throw new Error(customersResult.error.message);

    const properties = new Map((propertiesResult.data || []).map((row: any) => [String(row.id), row]));
    const customers = new Map((customersResult.data || []).map((row: any) => [String(row.id), row]));

    const portfolio = jobs.map((job: any) => {
      const property = properties.get(String(job.property_id)) as any;
      const customer = customers.get(String(job.customer_id)) as any;
      const dispatchRow = dispatchRows.get(String(job.id));
      return {
        jobId: String(job.id),
        customerId: job.customer_id || null,
        propertyId: job.property_id || null,
        customerName: customer?.full_name || "Customer",
        serviceName: job.service_name || dispatchRow?.serviceName || "Property Service",
        frequency: job.frequency || dispatchRow?.frequency || "one_time",
        nextVisitDate: job.next_visit_date || dispatchRow?.nextVisitDate || null,
        officialPhotoUrl: property?.official_photo_url || null,
        addressLine1: property?.address_line1 || "",
        city: property?.city || "",
        province: property?.province || "",
        postalCode: property?.postal_code || "",
        lotSize: property?.lot_size || null,
        grassHeight: property?.grass_height || null,
        gate: Boolean(property?.gate),
        dog: Boolean(property?.dog),
        irrigation: Boolean(property?.irrigation),
        accessNotes: property?.access_notes || null,
        propertyNotes: property?.property_notes || null,
      };
    }).filter((item: any) => Boolean(item.propertyId));

    portfolio.sort((left: any, right: any) =>
      String(left.customerName).localeCompare(String(right.customerName))
      || String(left.addressLine1).localeCompare(String(right.addressLine1)));

    return NextResponse.json({
      employee: { id: employee.id, name: employee.full_name || "Employee", avatarUrl },
      properties: portfolio,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Assigned customers could not be loaded." },
      { status: 400 },
    );
  }
}
