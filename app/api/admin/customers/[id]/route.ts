import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(254),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
  property: z.object({
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

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Admin customer editing is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCompanyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as a company Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active company Admin can use this customer editor.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Admin profile is not linked to a company.");
  return { client, companyId };
}

async function resolveRecord(client: any, companyId: string, id: string) {
  let property = await client.from("properties").select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (property.error) throw new Error(property.error.message);
  if (!property.data) {
    property = await client.from("properties").select("*").eq("customer_id", id).eq("company_id", companyId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (property.error) throw new Error(property.error.message);
  }
  if (!property.data) throw new Error("Property could not be found in this company.");
  const customer = await client.from("customers").select("*").eq("id", property.data.customer_id).eq("service_company_id", companyId).maybeSingle();
  if (customer.error || !customer.data) {
    const legacy = await client.from("customers").select("*").eq("id", property.data.customer_id).eq("company_id", companyId).maybeSingle();
    if (legacy.error || !legacy.data) throw new Error(legacy.error?.message || "Customer could not be found in this company.");
    return { customer: legacy.data, property: property.data };
  }
  return { customer: customer.data, property: property.data };
}

function isPlatformLocked(customer: any) {
  return customer.acquisition_source === "platform";
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { client, companyId } = await requireCompanyAdmin(request);
    const record = await resolveRecord(client, companyId, context.params.id);
    return NextResponse.json({
      ...record,
      permissions: {
        canEdit: !isPlatformLocked(record.customer),
        lockedByPlatform: isPlatformLocked(record.customer),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer profile could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const body = bodySchema.parse(await request.json());
    const { client, companyId } = await requireCompanyAdmin(request);
    const record = await resolveRecord(client, companyId, context.params.id);

    if (isPlatformLocked(record.customer)) {
      return NextResponse.json({
        error: "Locked by Platform. Contact the platform Master to change this customer or property.",
        code: "PLATFORM_CUSTOMER_LOCKED",
      }, { status: 403 });
    }

    const customerUpdate = await client.from("customers").update({
      full_name: body.customer.fullName,
      phone: body.customer.phone || null,
      email: body.customer.email,
      notes: body.customer.notes || null,
      updated_at: new Date().toISOString(),
    }).eq("id", record.customer.id).eq("company_id", companyId);
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
    }).eq("id", record.property.id).eq("company_id", companyId);
    if (propertyUpdate.error) throw new Error(propertyUpdate.error.message);

    return NextResponse.json({ saved: true, customerId: record.customer.id, propertyId: record.property.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer and property could not be saved." }, { status: 400 });
  }
}
