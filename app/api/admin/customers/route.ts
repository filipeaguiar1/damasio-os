import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listOperationalCompanyCustomers } from "@/lib/customers/operationalCustomerDirectory";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  customerNotes: z.string().trim().max(2000).optional(),
  addressLine1: z.string().trim().min(3).max(240),
  city: z.string().trim().max(120).default("Hamilton"),
  province: z.string().trim().max(40).default("ON"),
  postalCode: z.string().trim().max(20).optional(),
  lotSize: z.enum(["xs", "small", "legacy", "oversize"]).optional(),
  grassHeight: z.enum(["2in", "3in", "4in", "5in"]).optional(),
  gate: z.boolean().default(false),
  dog: z.boolean().default(false),
  irrigation: z.boolean().default(false),
  accessNotes: z.string().trim().max(2000).optional(),
  propertyNotes: z.string().trim().max(3000).optional(),
  serviceName: z.string().trim().min(2).max(160).default("Property Service"),
  frequency: z.enum(["weekly", "biweekly", "monthly", "adaptive", "one_time"]).default("one_time"),
  subtotal: z.number().min(0).max(1000000).default(0),
});

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
  const managerCanManage = profile?.role === "manager"
    && profile.manager_permissions?.customers === "manage";
  if (error || !profile?.active || (profile.role !== "admin" && !managerCanManage)) {
    throw new Error("Only a company Admin or Customer Manager can manage customers.");
  }
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId, actorId: auth.user.id };
}

function publicRecords(context: Awaited<ReturnType<typeof listOperationalCompanyCustomers>>) {
  const customers = new Map(context.customers.map(customer => [customer.id, customer]));
  return context.properties.map(property => {
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
  });
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    // GET is read-only. Ownership repair belongs to explicit write/migration paths;
    // mutating several tables during every page load caused concurrent Admin reads to fail.
    const context = await listOperationalCompanyCustomers(service, companyId, { repair: false });
    return NextResponse.json({
      records: publicRecords(context),
      customerCount: context.customers.length,
      propertyCount: context.properties.length,
      jobCount: context.jobs.length,
      repairedCustomerIds: context.repairedCustomerIds,
      source: "canonical-company-customer-directory",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customers could not be loaded.";
    const status = /sign in|session expired|only a company admin|customer manager/i.test(message) ? 401 : 500;
    console.error("admin-customers-get", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  let customerId = "";
  let propertyId = "";
  let quoteId = "";
  let jobId = "";
  try {
    const { service, companyId, actorId } = await companyAdmin(request);
    const body = createSchema.parse(await request.json());
    const tax = Math.round(body.subtotal * 0.13 * 100) / 100;
    const total = Math.round((body.subtotal + tax) * 100) / 100;

    const customer = await service.from("customers").insert({
      organization_id: companyId,
      company_id: companyId,
      service_company_id: companyId,
      full_name: body.fullName,
      email: body.email || null,
      phone: body.phone || null,
      notes: body.customerNotes || null,
      acquisition_source: "company_created",
      assignment_status: "active",
      offer_status: "accepted",
      platform_managed: false,
      archived_at: null,
    }).select("id").single();
    if (customer.error || !customer.data?.id) throw new Error(customer.error?.message || "Customer could not be created.");
    customerId = String(customer.data.id);

    const property = await service.from("properties").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      address_line1: body.addressLine1,
      city: body.city || "Hamilton",
      province: body.province || "ON",
      postal_code: body.postalCode || null,
      country: "Canada",
      lot_size: body.lotSize || null,
      grass_height: body.grassHeight || null,
      gate: body.gate,
      dog: body.dog,
      irrigation: body.irrigation,
      access_notes: body.accessNotes || null,
      property_notes: body.propertyNotes || null,
      geocode_status: "not_mapped",
    }).select("id,created_at").single();
    if (property.error || !property.data?.id) throw new Error(property.error?.message || "Property could not be created.");
    propertyId = String(property.data.id);

    const quoteNumber = `Q-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const quote = await service.from("quotes").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_number: quoteNumber,
      status: "approved",
      subtotal: body.subtotal,
      tax,
      total,
      notes: body.serviceName,
    }).select("id").single();
    if (quote.error || !quote.data?.id) throw new Error(quote.error?.message || "Quote could not be created.");
    quoteId = String(quote.data.id);

    const job = await service.from("jobs").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      quote_id: quoteId,
      service_name: body.serviceName,
      frequency: body.frequency,
      active: true,
      next_visit_date: null,
    }).select("id").single();
    if (job.error || !job.data?.id) throw new Error(job.error?.message || "Job could not be created.");
    jobId = String(job.data.id);

    // The canonical chain was just written successfully. Returning that exact chain
    // avoids a broad company-directory read while the database is under E2E load.
    // The normal GET remains the authoritative directory read for subsequent screens.
    const record = {
      customerId,
      propertyId,
      fullName: body.fullName,
      email: body.email || null,
      phone: body.phone || null,
      customerNotes: body.customerNotes || null,
      addressLine1: body.addressLine1,
      city: body.city || "Hamilton",
      province: body.province || "ON",
      postalCode: body.postalCode || null,
      lotSize: body.lotSize || null,
      grassHeight: body.grassHeight || null,
      gate: body.gate,
      dog: body.dog,
      irrigation: body.irrigation,
      accessNotes: body.accessNotes || null,
      propertyNotes: body.propertyNotes || null,
      officialPhotoUrl: null,
      acquisitionSource: "company_created",
      lockedByPlatform: false,
      offerStatus: "accepted",
      createdAt: property.data.created_at || new Date().toISOString(),
    };

    // Activity history is useful but must not turn a successfully-created canonical
    // Customer chain into a failed request when logging is temporarily contended.
    const activity = await service.from("activity_log").insert({
      organization_id: companyId,
      company_id: companyId,
      actor_profile_id: actorId,
      action: "Created canonical customer chain",
      entity_type: "customer",
      entity_id: customerId,
      details: `${body.fullName} was created with Property, approved Quote and active Job.`,
    });
    if (activity.error) console.warn("admin-customers-activity-log", activity.error.message);

    return NextResponse.json({ record, customerId, propertyId, quoteId, jobId }, { status: 201 });
  } catch (error) {
    const service = serverClient();
    if (jobId) await service.from("jobs").delete().eq("id", jobId);
    if (quoteId) await service.from("quotes").delete().eq("id", quoteId);
    if (propertyId) await service.from("properties").delete().eq("id", propertyId);
    if (customerId) await service.from("customers").delete().eq("id", customerId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer could not be created." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    const body = await request.json() as { customerIds?: string[] };
    const ids = [...new Set((body.customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) throw new Error("Select at least one customer.");
    const context = await listOperationalCompanyCustomers(service, companyId, { repair: true });
    const allowed = context.customers.filter(customer => ids.includes(customer.id)
      && customer.platform_managed !== true
      && customer.acquisition_source !== "platform").map(customer => customer.id);
    if (allowed.length !== ids.length) throw new Error("One or more customers cannot be removed by this company.");
    const now = new Date().toISOString();
    const archived = await service.from("customers").update({ archived_at: now }).in("id", allowed);
    if (archived.error) throw new Error(archived.error.message);
    const jobs = await service.from("jobs").update({ active: false }).in("customer_id", allowed).eq("active", true);
    if (jobs.error) throw new Error(jobs.error.message);
    await service.from("visits").update({ status: "cancelled", route_id: null, route_order: null })
      .in("customer_id", allowed).gte("scheduled_date", new Date().toISOString().slice(0, 10)).eq("status", "scheduled");
    return NextResponse.json({ removed: allowed.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customers could not be removed." }, { status: 400 });
  }
}