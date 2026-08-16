import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

type CustomerIdentity = {
  customerId: string;
  companyId: string;
};

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function missingColumn(message?: string, column?: string) {
  const value = String(message || "");
  return /schema cache|does not exist|could not find/i.test(value)
    && (!column || value.toLowerCase().includes(column.toLowerCase()));
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

function dateValue(value: unknown) {
  return String(value || "");
}

async function buildBoard(db: any, identity: CustomerIdentity) {
  const customerResult = await db.from("customers")
    .select("id,full_name,email,phone,profile_id,company_id,organization_id")
    .eq("id", identity.customerId)
    .maybeSingle();
  if (customerResult.error) throw new Error(customerResult.error.message);
  if (!customerResult.data) {
    return { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
  }
  const customerCompanyId = customerResult.data.company_id || customerResult.data.organization_id;
  if (customerCompanyId && String(customerCompanyId) !== identity.companyId) {
    throw new Error("Customer belongs to a different company.");
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

  const visitRows = await companyRows(
    db,
    "visits",
    "id,job_id,status,scheduled_date,crew_id,property_id,customer_visible_summary,employee_notes,duration_seconds,started_at,finished_at,created_at",
    identity.companyId,
    (query) => query.eq("customer_id", identity.customerId),
  );

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
    const { service: db, identity } = await requireCustomerPortalIdentity(request);
    if (!identity.companyId) throw new Error("Customer account has no company identity.");
    const board = await buildBoard(db, { customerId: identity.customerId, companyId: identity.companyId });
    return NextResponse.json({ board });
  } catch (error) {
    console.error("customer-portal-board", error);
    const message = error instanceof Error ? error.message : "Customer portal board failed.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return failure(message, status);
  }
}
