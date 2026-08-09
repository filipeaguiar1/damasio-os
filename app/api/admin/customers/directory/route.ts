import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const customerColumns = [
  "id", "full_name", "email", "phone", "notes", "company_id", "organization_id",
  "service_company_id", "assignment_status", "offer_status", "acquisition_source",
  "platform_managed", "archived_at", "created_at",
].join(",");

const propertyColumns = [
  "id", "customer_id", "address_line1", "city", "province", "postal_code", "lot_size",
  "grass_height", "gate", "dog", "irrigation", "access_notes", "property_notes",
  "official_photo_url", "created_at",
].join(",");

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical customer administration is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function companyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serverClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await service.from("profiles")
    .select("id,role,active,company_id,organization_id,manager_permissions")
    .eq("id", auth.user.id).single();
  const managerCanRead = profile?.role === "manager"
    && ["read", "manage"].includes(profile.manager_permissions?.customers || "");
  if (error || !profile?.active || (profile.role !== "admin" && !managerCanRead)) {
    throw new Error("Only a company Admin or Customer Manager can view customers.");
  }
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function directCompanyCustomer(customer: any, companyId: string) {
  return customer.company_id === companyId || customer.organization_id === companyId;
}

function acceptedServiceCustomer(customer: any, companyId: string) {
  return customer.service_company_id === companyId && (
    customer.offer_status === "accepted"
    || ["accepted", "assigned", "active"].includes(customer.assignment_status || "")
  );
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") || 50)));
    const query = normalized(url.searchParams.get("query"));
    const city = normalized(url.searchParams.get("city"));

    // Fast canonical read path. The previous directory reader performed several
    // ownership-reconciliation queries on every screen open. Repairs remain in
    // explicit maintenance flows; routine mobile reads only fetch the records
    // needed to render Customers.
    const customersResult = await service
      .from("customers")
      .select(customerColumns)
      .is("archived_at", null)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId},service_company_id.eq.${companyId}`);
    if (customersResult.error) throw new Error(customersResult.error.message);

    const customers = (customersResult.data || []).filter((customer: any) =>
      directCompanyCustomer(customer, companyId) || acceptedServiceCustomer(customer, companyId));
    const customerIds = customers.map((customer: any) => String(customer.id));

    if (!customerIds.length) {
      return NextResponse.json({
        records: [],
        pagination: { page: 1, pageSize, total: 0, pageCount: 1, hasNext: false, hasPrevious: false },
        counts: { customers: 0, properties: 0, pageJobs: 0 },
        source: "fast-canonical-company-customer-directory",
      }, { headers: { "Cache-Control": "private, max-age=10" } });
    }

    const [propertiesResult, jobsResult] = await Promise.all([
      service.from("properties").select(propertyColumns).in("customer_id", customerIds),
      service.from("jobs").select("id,customer_id,property_id").in("customer_id", customerIds).eq("active", true),
    ]);
    if (propertiesResult.error) throw new Error(propertiesResult.error.message);
    if (jobsResult.error) throw new Error(jobsResult.error.message);

    const customersById = new Map(customers.map((customer: any) => [String(customer.id), customer]));
    const records = (propertiesResult.data || []).map((property: any) => {
      const customer: any = customersById.get(String(property.customer_id));
      const source = customer?.acquisition_source || "company_created";
      return {
        customerId: property.customer_id,
        propertyId: property.id,
        fullName: customer?.full_name || "Customer",
        email: customer?.email || null,
        phone: customer?.phone || null,
        customerNotes: customer?.notes || null,
        addressLine1: property.address_line1,
        city: property.city,
        province: property.province,
        postalCode: property.postal_code,
        lotSize: property.lot_size,
        grassHeight: property.grass_height,
        gate: Boolean(property.gate),
        dog: Boolean(property.dog),
        irrigation: Boolean(property.irrigation),
        accessNotes: property.access_notes,
        propertyNotes: property.property_notes,
        officialPhotoUrl: property.official_photo_url,
        acquisitionSource: source,
        lockedByPlatform: customer?.platform_managed === true || source === "platform",
        offerStatus: customer?.offer_status || null,
        createdAt: property.created_at,
      };
    }).filter((record: any) => {
      if (city && normalized(record.city) !== city) return false;
      if (!query) return true;
      return normalized([
        record.fullName, record.email, record.phone, record.addressLine1,
        record.city, record.province, record.postalCode,
      ].filter(Boolean).join(" ")).includes(query);
    }).sort((left: any, right: any) =>
      String(left.city || "").localeCompare(String(right.city || ""))
      || String(left.addressLine1 || "").localeCompare(String(right.addressLine1 || ""))
      || String(left.propertyId).localeCompare(String(right.propertyId)));

    const total = records.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (safePage - 1) * pageSize;
    const pageRecords = records.slice(start, start + pageSize);
    const pageCustomerIds = new Set(pageRecords.map((record: any) => record.customerId));
    const pagePropertyIds = new Set(pageRecords.map((record: any) => record.propertyId));
    const jobCount = (jobsResult.data || []).filter((job: any) =>
      pageCustomerIds.has(job.customer_id) && pagePropertyIds.has(job.property_id)).length;

    return NextResponse.json({
      records: pageRecords,
      pagination: {
        page: safePage,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        hasNext: start + pageSize < total,
        hasPrevious: safePage > 1,
      },
      counts: {
        customers: new Set(records.map((record: any) => record.customerId)).size,
        properties: total,
        pageJobs: jobCount,
      },
      source: "fast-canonical-company-customer-directory",
    }, { headers: { "Cache-Control": "private, max-age=10" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customers could not be loaded.";
    const status = /sign in|session expired|only a company admin|customer manager/i.test(message) ? 401 : 500;
    console.error("admin-customers-directory-get", error);
    return NextResponse.json({ error: message }, { status });
  }
}
