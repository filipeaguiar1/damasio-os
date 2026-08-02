import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer request administration is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function missingColumn(message?: string, column?: string) {
  const value = String(message || "");
  return /schema cache|does not exist|could not find/i.test(value)
    && (!column || value.toLowerCase().includes(column.toLowerCase()));
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
    .maybeSingle();

  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can view customer requests.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId: String(companyId) };
}

async function loadServiceRequests(service: any, companyId: string) {
  let result = await service
    .from("service_requests")
    .select("id,customer_id,property_id,service_name,message,status,created_at,company_id,organization_id")
    .or(companyFilter(companyId))
    .order("created_at", { ascending: false })
    .limit(300);

  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await service
      .from("service_requests")
      .select("id,customer_id,property_id,service_name,message,status,created_at,organization_id")
      .eq("organization_id", companyId)
      .order("created_at", { ascending: false })
      .limit(300);
  }
  if (result.error) throw new Error(result.error.message);
  return (result.data || []).map((row: any) => ({ ...row, kind: "service_request" }));
}

async function loadCustomerTasks(service: any, companyId: string) {
  // Tasks are the canonical source. Do not require task_events: older customer
  // tasks and valid tasks created by other supported flows may not have a
  // matching creation event, but Admin must still see them immediately.
  let tasks = await service
    .from("tasks")
    .select("id,customer_id,property_id,title,customer_issue,status,priority,scheduled_date,created_at,company_id,organization_id")
    .or(companyFilter(companyId))
    .order("created_at", { ascending: false })
    .limit(300);

  if (tasks.error && missingColumn(tasks.error.message, "company_id")) {
    tasks = await service
      .from("tasks")
      .select("id,customer_id,property_id,title,customer_issue,status,priority,scheduled_date,created_at,organization_id")
      .eq("organization_id", companyId)
      .order("created_at", { ascending: false })
      .limit(300);
  }
  if (tasks.error) throw new Error(tasks.error.message);

  return (tasks.data || []).map((row: any) => ({
    ...row,
    kind: "customer_task",
    service_name: row.title,
    message: row.customer_issue,
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    const [serviceRequests, customerTasks] = await Promise.all([
      loadServiceRequests(service, companyId),
      loadCustomerTasks(service, companyId),
    ]);

    const rows = [...serviceRequests, ...customerTasks]
      .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const customerIds = [...new Set(rows.map((row: any) => row.customer_id).filter(Boolean))];
    const propertyIds = [...new Set(rows.map((row: any) => row.property_id).filter(Boolean))];
    const empty = Promise.resolve({ data: [] as any[], error: null });

    const [customersResult, propertiesResult] = await Promise.all([
      customerIds.length
        ? service.from("customers").select("id,full_name,email,phone").in("id", customerIds)
        : empty,
      propertyIds.length
        ? service.from("properties").select("id,address_line1,city,province,postal_code").in("id", propertyIds)
        : empty,
    ]);

    if (customersResult.error) throw new Error(customersResult.error.message);
    if (propertiesResult.error) throw new Error(propertiesResult.error.message);

    const customers = new Map((customersResult.data || []).map((row: any) => [row.id, row]));
    const properties = new Map((propertiesResult.data || []).map((row: any) => [row.id, row]));

    const requests = rows.map((row: any) => {
      const customer = customers.get(row.customer_id) as any;
      const property = properties.get(row.property_id) as any;
      return {
        id: String(row.id),
        kind: row.kind,
        serviceName: row.service_name || "Customer request",
        message: row.message || null,
        status: String(row.status || "pending"),
        priority: row.priority || null,
        scheduledDate: row.scheduled_date || null,
        customerId: row.customer_id || null,
        customerName: customer?.full_name || "Customer",
        email: customer?.email || null,
        phone: customer?.phone || null,
        propertyId: row.property_id || null,
        address: property
          ? [property.address_line1, property.city, property.province, property.postal_code].filter(Boolean).join(", ")
          : "Property not found",
        createdAt: row.created_at || null,
      };
    });

    const openStatuses = new Set(["pending", "open", "assigned", "in_progress"]);
    const pendingTasks = requests.filter(item => item.kind === "customer_task" && openStatuses.has(item.status));
    const pendingServiceRequests = requests.filter(item => item.kind === "service_request" && openStatuses.has(item.status));

    console.info("admin-service-requests-ok", {
      companyId,
      requestCount: requests.length,
      pendingTaskCount: pendingTasks.length,
      pendingServiceRequestCount: pendingServiceRequests.length,
      customerTaskIds: pendingTasks.map(item => item.id),
    });

    return NextResponse.json({
      requests,
      summary: {
        pendingTaskCount: pendingTasks.length,
        pendingServiceRequestCount: pendingServiceRequests.length,
        pendingTotal: pendingTasks.length + pendingServiceRequests.length,
      },
    }, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("admin-service-requests", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Customer requests could not be loaded." },
      { status: 400 },
    );
  }
}
