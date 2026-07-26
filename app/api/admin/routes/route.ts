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
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } }) as any;
}
async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await service.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active company Admin can manage routes.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, user: userClient(token), companyId };
}
function fail(error: unknown, status = 400) { return NextResponse.json({ error: error instanceof Error ? error.message : "Route request failed." }, { status }); }

async function ensureEmployees(service: any, companyId: string) {
  const { data: profiles, error } = await service.from("profiles").select("id,full_name,email,address_line1,route_start_address,active").eq("role", "employee").eq("active", true).or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).order("full_name");
  if (error) throw new Error(error.message);
  const { data: rows, error: employeeError } = await service.from("employees").select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if (employeeError) throw new Error(employeeError.message);
  const byProfile = new Map<string, any>();
  for (const row of rows || []) if (row.profile_id) byProfile.set(row.profile_id, row);
  const result: any[] = [];
  for (const profile of profiles || []) {
    let employee = byProfile.get(profile.id);
    if (!employee) {
      const created = await service.from("employees").insert({ company_id: companyId, organization_id: companyId, profile_id: profile.id, full_name: profile.full_name, email: profile.email, address_line1: profile.address_line1, route_start_address: profile.route_start_address || profile.address_line1, active: true, invite_status: "sent" }).select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active").single();
      if (created.error) throw new Error(created.error.message);
      employee = created.data;
    }
    if (!employee.crew_id) {
      const crew = await service.from("crews").insert({ company_id: companyId, organization_id: companyId, name: employee.full_name || profile.full_name || "Employee route", active: true }).select("id").single();
      if (crew.error) throw new Error(crew.error.message);
      const linked = await service.from("employees").update({ crew_id: crew.data.id }).eq("id", employee.id);
      if (linked.error) throw new Error(linked.error.message);
      employee.crew_id = crew.data.id;
    }
    result.push({ id: profile.id, employeeId: employee.id, crewId: employee.crew_id, name: profile.full_name || employee.full_name || "Employee", email: profile.email || employee.email || "", routeStartAddress: profile.route_start_address || profile.address_line1 || employee.route_start_address || employee.address_line1 || null });
  }
  return result;
}

async function canonicalJobs(service: any, user: any, companyId: string) {
  const customersResult = await service.from("customers").select("id,full_name,assignment_status,offer_status,service_company_id,company_id,organization_id,archived_at").is("archived_at", null).or(`service_company_id.eq.${companyId},company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if (customersResult.error) throw new Error(customersResult.error.message);
  const customers = (customersResult.data || []).filter((customer: any) => customer.offer_status === "accepted" || ["accepted", "assigned", "active"].includes(customer.assignment_status));
  const customerIds = customers.map((item: any) => item.id);
  if (!customerIds.length) return [];
  const propertyResult = await service.from("properties").select("id,customer_id,address_line1,city,province,postal_code,property_notes").in("customer_id", customerIds);
  if (propertyResult.error) throw new Error(propertyResult.error.message);
  const properties = propertyResult.data || [];
  const propertyByCustomer = new Map(properties.map((item: any) => [item.customer_id, item]));
  const jobsResult = await service.from("jobs").select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active").eq("active", true).or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const jobs = jobsResult.data || [];
  const jobByProperty = new Map(jobs.map((item: any) => [item.property_id, item]));
  for (const customer of customers) {
    const property: any = propertyByCustomer.get(customer.id);
    if (!property || jobByProperty.has(property.id)) continue;
    const inserted = await service.from("jobs").insert({ organization_id: companyId, company_id: companyId, customer_id: customer.id, property_id: property.id, service_name: property.property_notes?.split("\n")[0]?.replace(/^Service type:\s*/i, "") || "Property Service", frequency: "one_time", active: true }).select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active").single();
    if (inserted.error) throw new Error(inserted.error.message);
    jobs.push(inserted.data);
    jobByProperty.set(property.id, inserted.data);
  }
  const assignmentByJob = new Map<string, { crewId: string | null; crewName: string | null; routeOrder: number | null; routeDate: string | null }>();
  const assignmentResult = await user.rpc("get_company_dispatch_jobs");
  if (!assignmentResult.error && Array.isArray(assignmentResult.data)) for (const row of assignmentResult.data) {
    const id = row.id || row.jobId; if (!id) continue;
    assignmentByJob.set(id, { crewId: row.crewId || row.crew_id || null, crewName: row.crewName || row.crew_name || null, routeOrder: row.defaultRouteOrder ?? row.default_route_order ?? null, routeDate: row.recurrenceAnchorDate || row.recurrence_anchor_date || null });
  }
  const customerNames = new Map(customers.map((item: any) => [item.id, item.full_name]));
  const propertyById = new Map(properties.map((item: any) => [item.id, item]));
  return jobs.map((job: any) => { const property: any = propertyById.get(job.property_id); const assignment = assignmentByJob.get(job.id); return {
    id: job.id, serviceName: job.service_name || "Property Service", frequency: job.frequency || "one_time", nextVisitDate: job.next_visit_date || null,
    customerName: customerNames.get(job.customer_id) || "Customer", address: property ? [property.address_line1, property.city, property.province, property.postal_code].filter(Boolean).join(", ") : "Address missing",
    propertyId: job.property_id, customerId: job.customer_id, quoteId: null, crewId: assignment?.crewId || null, crewName: assignment?.crewName || null,
    recurrenceAnchorDate: assignment?.routeDate || job.recurrence_anchor_date || null, defaultRouteOrder: assignment?.routeOrder ?? job.default_route_order ?? null, createdAt: job.created_at,
  }; });
}

export async function GET(request: NextRequest) {
  try { const { service, user, companyId } = await requireAdmin(request); const [employees, jobs] = await Promise.all([ensureEmployees(service, companyId), canonicalJobs(service, user, companyId)]); return NextResponse.json({ employees, board: { crews: [], unscheduledJobs: jobs.filter((job: any) => !job.crewId), assignedJobs: jobs.filter((job: any) => Boolean(job.crewId)), visits: [], tasks: [], activity: [] } }); }
  catch (error) { return fail(error, 401); }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const body = await request.json() as { action?: "assign"|"smart"|"move"; jobIds?: string[]; crewId?: string; routeDate?: string };
    const jobIds = [...new Set((body.jobIds || []).filter(Boolean))];
    if (!body.crewId) throw new Error("Select an Employee.");
    if (!jobIds.length) throw new Error("Select at least one customer.");
    const action = body.action || "assign";
    if (action === "assign") {
      for (const jobId of jobIds) { const result = await user.rpc("assign_job_to_crew", { p_job_id: jobId, p_crew_id: body.crewId }); if (result.error) throw new Error(result.error.message); }
      return NextResponse.json({ saved: true, count: jobIds.length, action });
    }
    if (!body.routeDate) throw new Error("Select a route date.");
    for (let index = 0; index < jobIds.length; index++) {
      const result = await user.rpc("save_job_route_pattern", { p_job_id: jobIds[index], p_crew_id: body.crewId, p_route_date: body.routeDate, p_route_order: Number(index + 1) });
      if (result.error) throw new Error(result.error.message);
    }
    return NextResponse.json({ saved: true, count: jobIds.length, action });
  } catch (error) { return fail(error); }
}
