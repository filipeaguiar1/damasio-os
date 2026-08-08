import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listOperationalCompanyCustomers } from "@/lib/customers/operationalCustomerDirectory";

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") || 50)));
    const query = normalized(url.searchParams.get("query"));
    const city = normalized(url.searchParams.get("city"));

    const context = await listOperationalCompanyCustomers(service, companyId, { repair: false });
    const customers = new Map(context.customers.map(customer => [customer.id, customer]));
    const records = context.properties.map(property => {
      const customer = customers.get(property.customer_id);
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
    }).filter(record => {
      if (city && normalized(record.city) !== city) return false;
      if (!query) return true;
      return normalized([
        record.fullName, record.email, record.phone, record.addressLine1,
        record.city, record.province, record.postalCode,
      ].filter(Boolean).join(" ")).includes(query);
    }).sort((left, right) =>
      left.city.localeCompare(right.city)
      || left.addressLine1.localeCompare(right.addressLine1)
      || left.propertyId.localeCompare(right.propertyId));

    const total = records.length;
    const start = (page - 1) * pageSize;
    const pageRecords = records.slice(start, start + pageSize);
    const customerIds = new Set(pageRecords.map(record => record.customerId));
    const propertyIds = new Set(pageRecords.map(record => record.propertyId));
    const jobCount = context.jobs.filter(job =>
      customerIds.has(job.customer_id) && propertyIds.has(job.property_id)).length;

    return NextResponse.json({
      records: pageRecords,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        hasNext: start + pageSize < total,
        hasPrevious: page > 1,
      },
      counts: {
        customers: new Set(records.map(record => record.customerId)).size,
        properties: total,
        pageJobs: jobCount,
      },
      source: "paginated-canonical-company-customer-directory",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customers could not be loaded.";
    const status = /sign in|session expired|only a company admin|customer manager/i.test(message) ? 401 : 500;
    console.error("admin-customers-directory-get", error);
    return NextResponse.json({ error: message }, { status });
  }
}
