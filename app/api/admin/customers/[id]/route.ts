import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const customerSchema = z.object({
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(254),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
}).strict();

const responseSchema = z.object({
  action: z.enum(["accept", "decline"]),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Admin customer management is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCompanyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as a company Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active company Admin can use this customer profile.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Admin profile is not linked to a company.");
  return { client, companyId, adminId: auth.user.id };
}

async function resolveRecord(client: any, companyId: string, id: string) {
  const propertyResult = await client.from("properties").select("*").eq("id", id).maybeSingle();
  if (propertyResult.error) throw new Error(propertyResult.error.message);
  const customerId = propertyResult.data?.customer_id || id;
  const customerResult = await client
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .or(`service_company_id.eq.${companyId},company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .maybeSingle();
  if (customerResult.error || !customerResult.data) throw new Error(customerResult.error?.message || "Customer could not be found in this company.");

  let property = propertyResult.data;
  if (!property) {
    const firstProperty = await client.from("properties").select("*").eq("customer_id", customerId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (firstProperty.error) throw new Error(firstProperty.error.message);
    property = firstProperty.data;
  }
  if (!property) throw new Error("Property could not be found for this customer.");
  return { customer: customerResult.data, property };
}

function isPlatformCustomer(customer: any) {
  return customer.platform_managed === true || customer.acquisition_source === "platform";
}

function publicCustomer(customer: any) {
  if (!isPlatformCustomer(customer)) return customer;
  return { ...customer, phone: null, email: null };
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { client, companyId } = await requireCompanyAdmin(request);
    const record = await resolveRecord(client, companyId, context.params.id);
    return NextResponse.json({
      customer: publicCustomer(record.customer),
      property: record.property,
      permissions: {
        canEditCustomer: !isPlatformCustomer(record.customer),
        canEditProperty: false,
        contactHidden: isPlatformCustomer(record.customer),
        lockedByPlatform: isPlatformCustomer(record.customer),
      },
      offer: {
        status: record.customer.offer_status || null,
        price: record.customer.offered_service_price == null ? null : Number(record.customer.offered_service_price),
        sentAt: record.customer.offer_sent_at || null,
        respondedAt: record.customer.offer_responded_at || null,
        responseNote: record.customer.offer_response_note || null,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer profile could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const body = customerSchema.parse(await request.json());
    const { client, companyId } = await requireCompanyAdmin(request);
    const record = await resolveRecord(client, companyId, context.params.id);
    if (isPlatformCustomer(record.customer)) {
      return NextResponse.json({ error: "Platform customer contact and profile data can only be changed by Master.", code: "PLATFORM_CUSTOMER_LOCKED" }, { status: 403 });
    }

    const customerUpdate = await client.from("customers").update({
      full_name: body.customer.fullName,
      phone: body.customer.phone || null,
      email: body.customer.email,
      notes: body.customer.notes || null,
    })
      .eq("id", record.customer.id)
      .or(`service_company_id.eq.${companyId},company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .select("id")
      .maybeSingle();
    if (customerUpdate.error) throw new Error(customerUpdate.error.message);
    if (!customerUpdate.data?.id) throw new Error("Customer ownership changed before the update could be saved. Refresh and try again.");
    return NextResponse.json({ saved: true, customerId: record.customer.id, propertyId: record.property.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer could not be saved." }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const body = responseSchema.parse(await request.json());
    const { client, companyId, adminId } = await requireCompanyAdmin(request);
    const record = await resolveRecord(client, companyId, context.params.id);
    if (record.customer.offer_status !== "offered") throw new Error("This customer offer is no longer pending.");

    const now = new Date().toISOString();
    if (body.action === "decline") {
      const declined = await client.from("customers").update({
        previous_service_company_id: companyId,
        service_company_id: null,
        assignment_status: "ready_for_assignment",
        offer_status: "declined",
        offer_responded_at: now,
        offer_response_note: body.note || null,
      }).eq("id", record.customer.id).eq("service_company_id", companyId);
      if (declined.error) throw new Error(declined.error.message);
      await client.from("activity_log").insert({ organization_id: companyId, company_id: companyId, action: "Declined platform customer offer", entity_type: "customer", entity_id: record.customer.id, details: body.note || "Offer declined by company Admin." });
      return NextResponse.json({ accepted: false, message: "Customer offer declined and returned to Master." });
    }

    const accepted = await client.from("customers").update({
      company_id: companyId,
      organization_id: companyId,
      assignment_status: "accepted",
      offer_status: "accepted",
      offer_responded_at: now,
      offer_response_note: body.note || null,
    }).eq("id", record.customer.id).eq("service_company_id", companyId);
    if (accepted.error) throw new Error(accepted.error.message);

    const linkedPatch = { company_id: companyId, organization_id: companyId };
    const propertyUpdate = await client.from("properties").update(linkedPatch).eq("customer_id", record.customer.id);
    if (propertyUpdate.error) throw new Error(propertyUpdate.error.message);
    await client.from("service_requests").update(linkedPatch).eq("customer_id", record.customer.id).not("status", "in", "(completed,cancelled,rejected)");
    await client.from("jobs").update(linkedPatch).eq("customer_id", record.customer.id).eq("active", true);

    const existingJob = await client.from("jobs").select("id").eq("customer_id", record.customer.id).eq("property_id", record.property.id).eq("active", true).limit(1).maybeSingle();
    if (!existingJob.error && !existingJob.data) {
      const quote = await client.from("quotes").select("id,notes,total,subtotal").eq("customer_id", record.customer.id).eq("property_id", record.property.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const serviceName = quote.data?.notes || record.property.property_notes?.split("\n")[0]?.replace(/^Service type:\s*/i, "") || "Property Service";
      const jobInsert = await client.from("jobs").insert({
        organization_id: companyId,
        company_id: companyId,
        customer_id: record.customer.id,
        property_id: record.property.id,
        quote_id: quote.data?.id || null,
        service_name: serviceName,
        frequency: "one_time",
        active: true,
      });
      if (jobInsert.error) throw new Error(jobInsert.error.message);
    }

    await client.from("activity_log").insert({
      organization_id: companyId,
      company_id: companyId,
      actor_profile_id: adminId,
      action: "Accepted platform customer offer",
      entity_type: "customer",
      entity_id: record.customer.id,
      details: `Accepted at $${Number(record.customer.offered_service_price || 0).toFixed(2)} CAD. Customer and property released to company operations.`,
    });

    return NextResponse.json({ accepted: true, message: "Customer accepted. The property is now available to Schedule, Dispatch and Route." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer offer response failed." }, { status: 400 });
  }
}
