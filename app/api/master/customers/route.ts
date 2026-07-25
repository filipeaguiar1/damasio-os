import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  action: z.literal("save"),
  customerId: z.string().uuid(),
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
  property: z.object({
    propertyId: z.string().uuid(),
    addressLine1: z.string().trim().min(3).max(240),
    city: z.string().trim().min(2).max(120),
    province: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().max(20).nullable().optional(),
    lotSize: z.string().trim().max(80).nullable().optional(),
    grassHeight: z.string().trim().max(40).nullable().optional(),
    gate: z.boolean(),
    dog: z.boolean(),
    irrigation: z.boolean(),
    accessNotes: z.string().trim().max(2000).nullable().optional(),
    propertyNotes: z.string().trim().max(3000).nullable().optional(),
    customerComment: z.string().trim().max(1500).nullable().optional(),
  }),
}).strict();

const transferSchema = z.object({
  action: z.literal("transfer"),
  customerId: z.string().uuid(),
  serviceCompanyId: z.string().uuid().nullable(),
  reason: z.string().trim().max(1000).nullable().optional(),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master customer management is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can manage customers.");
  return { client, masterId: auth.user.id };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Customer request failed." }, { status });
}

async function companyMap(client: any) {
  const { data, error } = await client.from("organizations").select("id,name,active,referral_code").is("deleted_at", null).order("name");
  if (error) throw new Error(error.message);
  return data || [];
}

async function customerDetail(client: any, customerId: string) {
  const { data: customer, error } = await client
    .from("customers")
    .select("id,full_name,email,phone,notes,created_at,profile_id,company_id,organization_id,acquisition_source,origin_company_id,service_company_id,referral_code_used,assignment_status,first_payment_at,last_transfer_at,last_transfer_reason,previous_service_company_id,platform_managed")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !customer) throw new Error(error?.message || "Customer not found.");

  const [properties, quotes, invoices, payments, companies] = await Promise.all([
    client.from("properties").select("id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,customer_comment,official_photo_url,created_at").eq("customer_id", customerId).order("created_at"),
    client.from("quotes").select("id,quote_number,status,subtotal,tax,total,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
    client.from("invoices").select("id,invoice_number,status,subtotal,tax,total,created_at,paid_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
    client.from("payments").select("id,status,amount,provider,provider_reference,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
    companyMap(client),
  ]);

  return {
    customer,
    properties: properties.data || [],
    quotes: quotes.data || [],
    invoices: invoices.data || [],
    payments: payments.data || [],
    companies,
    warnings: [properties.error, quotes.error, invoices.error, payments.error].filter(Boolean).map((item: any) => item.message),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { client } = await requireMaster(request);
    const customerId = request.nextUrl.searchParams.get("id");
    if (customerId) return NextResponse.json(await customerDetail(client, customerId));

    const [customersResult, propertiesResult, companies] = await Promise.all([
      client.from("customers").select("id,full_name,email,phone,created_at,company_id,acquisition_source,origin_company_id,service_company_id,assignment_status,first_payment_at,last_transfer_at,platform_managed").is("archived_at", null).order("created_at", { ascending: false }),
      client.from("properties").select("id,customer_id,address_line1,city,province,postal_code,official_photo_url,created_at").order("created_at"),
      companyMap(client),
    ]);
    if (customersResult.error) throw new Error(customersResult.error.message);
    if (propertiesResult.error) throw new Error(propertiesResult.error.message);

    const names = new Map(companies.map((company: any) => [company.id, company.name]));
    const propertyByCustomer = new Map<string, any>();
    for (const property of propertiesResult.data || []) if (!propertyByCustomer.has(property.customer_id)) propertyByCustomer.set(property.customer_id, property);

    return NextResponse.json({
      companies,
      customers: (customersResult.data || []).map((customer: any) => ({
        ...customer,
        property: propertyByCustomer.get(customer.id) || null,
        originCompanyName: customer.origin_company_id ? names.get(customer.origin_company_id) || "Unknown company" : "Platform",
        serviceCompanyName: customer.service_company_id ? names.get(customer.service_company_id) || "Unknown company" : "Unassigned",
        platformManaged: customer.platform_managed === true || customer.acquisition_source === "platform",
      })),
    });
  } catch (error) {
    return fail(error, 401);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const raw = await request.json();

    if (raw?.action === "save") {
      const body = saveSchema.parse(raw);
      const customerUpdate = await client.from("customers").update({
        full_name: body.customer.fullName,
        email: body.customer.email,
        phone: body.customer.phone || null,
        notes: body.customer.notes || null,
        updated_at: new Date().toISOString(),
      }).eq("id", body.customerId);
      if (customerUpdate.error) throw new Error(customerUpdate.error.message);

      const propertyUpdate = await client.from("properties").update({
        address_line1: body.property.addressLine1,
        city: body.property.city,
        province: body.property.province,
        postal_code: body.property.postalCode || null,
        lot_size: body.property.lotSize || null,
        grass_height: body.property.grassHeight || null,
        gate: body.property.gate,
        dog: body.property.dog,
        irrigation: body.property.irrigation,
        access_notes: body.property.accessNotes || null,
        property_notes: body.property.propertyNotes || null,
        customer_comment: body.property.customerComment || null,
        updated_at: new Date().toISOString(),
      }).eq("id", body.property.propertyId).eq("customer_id", body.customerId);
      if (propertyUpdate.error) throw new Error(propertyUpdate.error.message);

      await client.from("master_audit_log").insert({
        master_profile_id: masterId,
        action: "customer.profile_updated",
        entity_type: "customer",
        entity_id: body.customerId,
        details: { property_id: body.property.propertyId },
      });
      return NextResponse.json({ saved: true, message: "Customer and property updated by Master." });
    }

    const body = transferSchema.parse(raw);
    const { data, error } = await client.rpc("master_transfer_customer", {
      p_customer_id: body.customerId,
      p_service_company_id: body.serviceCompanyId,
      p_reason: body.reason || null,
    });
    if (error || !data) throw new Error(error?.message || "Customer could not be transferred.");

    await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: body.serviceCompanyId,
      action: body.serviceCompanyId ? "customer.service_company_changed" : "customer.returned_to_assignment_queue",
      entity_type: "customer",
      entity_id: body.customerId,
      details: { reason: body.reason || null, origin_company_id: data.origin_company_id, previous_service_company_id: data.previous_service_company_id },
    });

    return NextResponse.json({
      customer: data,
      message: body.serviceCompanyId
        ? "Customer moved to the selected company. No new code or quote was required."
        : "Customer returned to the Master assignment queue.",
    });
  } catch (error) {
    return fail(error);
  }
}
