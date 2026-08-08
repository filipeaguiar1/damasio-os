import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type CustomerIdentity = {
  customerId: string;
  companyId: string;
};

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer portal board fallback is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function missingColumn(message?: string, column?: string) {
  const value = String(message || "");
  return /schema cache|does not exist|could not find/i.test(value)
    && (!column || value.toLowerCase().includes(column.toLowerCase()));
}

async function resolveCustomer(db: any, token: string): Promise<CustomerIdentity> {
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your customer session expired. Sign in again.");

  const profile = await db.from("profiles")
    .select("id,role,active,company_id,organization_id,email")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data?.active || profile.data.role !== "customer") {
    throw new Error("Only an active Customer account can use this portal.");
  }

  const metadataCustomerId = auth.data.user.user_metadata?.customer_id;
  let customer: any = null;
  if (metadataCustomerId) {
    const byMetadata = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .eq("id", metadataCustomerId)
      .maybeSingle();
    if (!byMetadata.error) customer = byMetadata.data;
  }
  if (!customer) {
    const byProfile = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .eq("profile_id", auth.data.user.id)
      .maybeSingle();
    if (!byProfile.error) customer = byProfile.data;
  }
  if (!customer && auth.data.user.email) {
    const byEmail = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .ilike("email", auth.data.user.email.trim())
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!byEmail.error) customer = byEmail.data;
  }
  if (!customer || customer.archived_at) throw new Error("Customer record was not found for this account.");

  const profileCompanyId = profile.data.company_id || profile.data.organization_id;
  const customerCompanyId = customer.company_id || customer.organization_id;
  const metadataCompanyId = auth.data.user.user_metadata?.company_id;
  const companyId = String(profileCompanyId || customerCompanyId || metadataCompanyId || "");
  if (!companyId) throw new Error("Customer account has no company identity.");
  if (customerCompanyId && String(customerCompanyId) !== companyId) {
    throw new Error("Customer company identity does not match the signed-in account.");
  }

  if (!customer.profile_id) {
    await db.from("customers").update({ profile_id: auth.data.user.id }).eq("id", customer.id).is("profile_id", null);
  } else if (String(customer.profile_id) !== String(auth.data.user.id)) {
    throw new Error("Customer record is linked to a different account.");
  }

  return { customerId: String(customer.id), companyId };
}

async function companyRows(
  db: any,
  table: string,
  columns: string,
  companyId: string,
  apply: (query: any) => any,
) {
  let result = await apply(db.from(table).select(columns).eq("company_id", companyId));
  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await apply(db.from(table).select(columns).eq("organization_id", companyId));
  }
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data || [];
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
  return result;
}

function dateValue(value: unknown) {
  return String(value || "");
}

async function buildBoard(db: any, identity: CustomerIdentity) {
  const customerResult = await db.from("customers")
    .select("id,full_name,email,phone")
    .eq("id", identity.customerId)
    .maybeSingle();
  if (customerResult.error) throw new Error(customerResult.error.message);
  if (!customerResult.data) {
    return { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
  }

  const properties = await companyRows(
    db,
    "properties",
    "id,customer_id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId).order("created_at", { ascending: true }),
  );
  const propertyById = new Map<string, any>(properties.map((row: any) => [String(row.id), row] as [string, any]));
  const primaryProperty = properties[0] || null;

  const jobs = await companyRows(
    db,
    "jobs",
    "id,service_name,customer_id",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );
  const jobById = new Map<string, any>(jobs.map((row: any) => [String(row.id), row] as [string, any]));
  const jobIds = jobs.map((row: any) => String(row.id));

  const visitRows: any[] = [];
  for (const batch of chunks(jobIds, 12)) {
    const activeRows = await companyRows(
      db,
      "visits",
      "id,job_id,status,scheduled_date,crew_id,property_id,customer_visible_summary,employee_notes,duration_seconds,started_at,finished_at,created_at",
      identity.companyId,
      (query) => query.in("job_id", batch).neq("status", "cancelled"),
    );
    visitRows.push(...activeRows);
    const cancelledRows = await companyRows(
      db,
      "visits",
      "id,job_id,status,scheduled_date,crew_id,property_id,customer_visible_summary,employee_notes,duration_seconds,started_at,finished_at,created_at",
      identity.companyId,
      (query) => query.in("job_id", batch).eq("status", "cancelled"),
    );
    visitRows.push(...cancelledRows);
  }

  const crewIds = [...new Set(visitRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];
  const crewResult = crewIds.length
    ? await db.from("crews").select("id,name").in("id", crewIds)
    : { data: [], error: null };
  if (crewResult.error) throw new Error(`crews: ${crewResult.error.message}`);
  const crewById = new Map<string, any>((crewResult.data || []).map((row: any) => [String(row.id), row] as [string, any]));

  const tasks = await companyRows(
    db,
    "tasks",
    "id,title,customer_issue,priority,status,scheduled_date,property_id,resolved_at,completion_summary,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );
  const requests = await companyRows(
    db,
    "service_requests",
    "id,service_name,message,status,property_id,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );
  const requestById = new Map<string, any>(requests.map((row: any) => [String(row.id), row] as [string, any]));
  const quotes = await companyRows(
    db,
    "quotes",
    "id,quote_number,status,request_id,property_id,subtotal,tax,total,notes,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );
  const feedback = await companyRows(
    db,
    "feedback",
    "id,rating,comment,visit_id,task_id,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );

  const visits = visitRows.map((row: any) => ({
    id: String(row.id),
    serviceName: jobById.get(String(row.job_id))?.service_name || "Service Visit",
    status: String(row.status),
    scheduledDate: row.scheduled_date || null,
    crewName: row.crew_id ? crewById.get(String(row.crew_id))?.name || null : null,
    address: row.property_id ? propertyById.get(String(row.property_id))?.address_line1 || null : null,
    propertyId: row.property_id ? String(row.property_id) : null,
    customerVisibleSummary: row.customer_visible_summary || null,
    employeeNotes: row.employee_notes || null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    createdAt: String(row.created_at),
  })).sort((left: any, right: any) =>
    dateValue(right.scheduledDate).localeCompare(dateValue(left.scheduledDate))
    || dateValue(right.createdAt).localeCompare(dateValue(left.createdAt)));

  const taskBoard = tasks.map((row: any) => ({
    id: String(row.id), title: String(row.title || ""), customerIssue: String(row.customer_issue || ""),
    priority: String(row.priority || "normal"), status: String(row.status || ""), scheduledDate: row.scheduled_date || null,
    address: row.property_id ? propertyById.get(String(row.property_id))?.address_line1 || null : null,
    propertyId: row.property_id ? String(row.property_id) : null, resolvedAt: row.resolved_at || null,
    completionSummary: row.completion_summary || null, createdAt: String(row.created_at),
  })).sort((left: any, right: any) => dateValue(right.createdAt).localeCompare(dateValue(left.createdAt)));

  const requestBoard = requests.map((row: any) => ({
    id: String(row.id), serviceName: String(row.service_name || ""), message: row.message || null,
    status: String(row.status || ""),
    address: row.property_id ? propertyById.get(String(row.property_id))?.address_line1 || null : null,
    createdAt: String(row.created_at),
  })).sort((left: any, right: any) => dateValue(right.createdAt).localeCompare(dateValue(left.createdAt)));

  const quoteBoard = quotes.map((row: any) => ({
    id: String(row.id), quoteNumber: String(row.quote_number || ""), status: String(row.status || ""),
    serviceName: (row.request_id ? requestById.get(String(row.request_id))?.service_name : null) || row.notes || "Service Quote",
    address: row.property_id ? propertyById.get(String(row.property_id))?.address_line1 || null : null,
    subtotal: Number(row.subtotal || 0), tax: Number(row.tax || 0), total: Number(row.total || 0), notes: row.notes || null,
    createdAt: String(row.created_at),
  })).sort((left: any, right: any) => dateValue(right.createdAt).localeCompare(dateValue(left.createdAt)));

  const feedbackBoard = feedback.map((row: any) => ({
    id: String(row.id), rating: row.rating == null ? null : Number(row.rating), comment: row.comment || null,
    visitId: row.visit_id ? String(row.visit_id) : null, taskId: row.task_id ? String(row.task_id) : null,
    createdAt: String(row.created_at),
  })).sort((left: any, right: any) => dateValue(right.createdAt).localeCompare(dateValue(left.createdAt)));

  return {
    property: {
      customerId: String(customerResult.data.id),
      propertyId: primaryProperty ? String(primaryProperty.id) : "",
      customerName: String(customerResult.data.full_name || ""),
      email: customerResult.data.email || null,
      phone: customerResult.data.phone || null,
      address: primaryProperty?.address_line1 || "",
      city: primaryProperty?.city || "",
      province: primaryProperty?.province || "",
      postalCode: primaryProperty?.postal_code || null,
      lotSize: primaryProperty?.lot_size || null,
      grassHeight: primaryProperty?.grass_height || null,
      gate: Boolean(primaryProperty?.gate), dog: Boolean(primaryProperty?.dog), irrigation: Boolean(primaryProperty?.irrigation),
      accessNotes: primaryProperty?.access_notes || null, propertyNotes: primaryProperty?.property_notes || null,
    },
    visits,
    tasks: taskBoard,
    requests: requestBoard,
    quotes: quoteBoard,
    feedback: feedbackBoard,
  };
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in as the Customer to continue.", 401);
    const db = serverClient();
    const identity = await resolveCustomer(db, token);
    const board = await buildBoard(db, identity);
    return NextResponse.json({ board });
  } catch (error) {
    console.error("customer-portal-board", error);
    const message = error instanceof Error ? error.message : "Customer portal board failed.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return failure(message, status);
  }
}
