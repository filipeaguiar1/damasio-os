import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  companyId: z.string().uuid(),
  finalTotal: z.number().positive().max(100000),
  message: z.string().trim().min(2).max(1500),
  // Kept for API compatibility. Customer access is intentionally released only
  // after the company accepts the referral.
  sendInvite: z.boolean().optional().default(true),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master lead response is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Lead response failed." }, { status });
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") {
    throw new Error("Only Master can prepare a platform quote response.");
  }
  return { client, masterId: auth.user.id };
}

function quoteNumber(count: number) {
  return `EST-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

type QuotePropertyDetails = {
  lawnSize?: "xs" | "small" | "legacy" | "oversize";
  grassHeight?: "2in" | "3in" | "4in" | "5in";
  grassHandling?: string;
  backyard?: boolean;
  gated?: boolean;
  annual?: boolean;
};

function extractPropertyDetails(notes: unknown): QuotePropertyDetails | null {
  const text = String(notes || "");
  const marker = "PROPERTY_DETAILS:";
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const jsonEnd = text.indexOf(" | ", jsonStart);
  const raw = text.slice(jsonStart, jsonEnd >= 0 ? jsonEnd : undefined).trim();
  try { return JSON.parse(raw) as QuotePropertyDetails; } catch { return null; }
}

function cleanLeadNotes(notes: unknown) {
  return String(notes || "")
    .split(" | ")
    .filter((part) => !part.startsWith("PROPERTY_DETAILS:"))
    .join(" | ")
    .trim();
}

function propertyValues(details: QuotePropertyDetails | null) {
  if (!details) return {};
  const propertyNotes = [
    details.grassHandling ? `Grass handling: ${details.grassHandling.replaceAll("_", " ")}` : null,
    typeof details.backyard === "boolean" ? `Backyard: ${details.backyard ? "Yes" : "No"}` : null,
    typeof details.annual === "boolean" ? `Annual plan requested: ${details.annual ? "Yes" : "No"}` : null,
  ].filter(Boolean).join(" | ") || null;
  return {
    lot_size: details.lawnSize || null,
    grass_height: details.grassHeight || null,
    gate: Boolean(details.gated),
    property_notes: propertyNotes,
  };
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const leadId = String(context.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leadId)) throw new Error("Choose a valid lead.");

    const body = schema.parse(await request.json());
    const { client, masterId } = await requireMaster(request);

    const { data: lead, error: leadError } = await client.from("lead_center")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError || !lead) throw new Error(leadError?.message || "Lead not found.");
    if (!["new", "offered"].includes(String(lead.status))) {
      throw new Error("This lead already has a final company decision.");
    }

    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) throw new Error("This lead needs an email before a quote can be prepared.");

    const { data: company, error: companyError } = await client.from("organizations")
      .select("id,name,active")
      .eq("id", body.companyId)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (companyError || !company) throw new Error(companyError?.message || "Choose an active company.");

    // Public quote flow currently operates in Ontario. The canonical recurring
    // billing engine later stores tax explicitly on each Billing Agreement.
    const subtotal = Math.round((body.finalTotal / 1.13) * 100) / 100;
    const tax = Math.round((body.finalTotal - subtotal) * 100) / 100;
    const total = Math.round(body.finalTotal * 100) / 100;
    const quoteDetails = extractPropertyDetails(lead.notes);
    const publicNotes = cleanLeadNotes(lead.notes);
    const notes = [
      publicNotes,
      `Master response: ${body.message}`,
      `Final quoted amount: $${total.toFixed(2)}`,
    ].filter(Boolean).join(" | ");

    const { data: existingCustomer, error: existingCustomerError } = await client.from("customers")
      .select("id,profile_id")
      .eq("company_id", body.companyId)
      .ilike("email", email)
      .is("archived_at", null)
      .maybeSingle();
    if (existingCustomerError) throw new Error(existingCustomerError.message);

    let customerId = String(existingCustomer?.id || "");
    if (!customerId) {
      const { data: createdCustomer, error: customerError } = await client.from("customers").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        full_name: lead.full_name,
        email,
        phone: lead.phone || null,
        notes,
      }).select("id").single();
      if (customerError || !createdCustomer) throw new Error(customerError?.message || "Customer could not be prepared.");
      customerId = String(createdCustomer.id);
    } else {
      const { error: customerUpdateError } = await client.from("customers").update({
        full_name: lead.full_name,
        phone: lead.phone || null,
        notes,
      }).eq("id", customerId);
      if (customerUpdateError) throw new Error(customerUpdateError.message);
    }

    const address = String(lead.address || "").trim();
    let propertyId = "";
    if (address) {
      const { data: existingProperty, error: existingPropertyError } = await client.from("properties")
        .select("id")
        .eq("company_id", body.companyId)
        .eq("customer_id", customerId)
        .eq("address_line1", address)
        .maybeSingle();
      if (existingPropertyError) throw new Error(existingPropertyError.message);

      propertyId = String(existingProperty?.id || "");
      const canonicalProperty = {
        organization_id: body.companyId,
        company_id: body.companyId,
        customer_id: customerId,
        address_line1: address,
        city: "Hamilton",
        province: "ON",
        country: "Canada",
        ...propertyValues(quoteDetails),
      };

      if (!propertyId) {
        const { data: createdProperty, error: propertyError } = await client.from("properties")
          .insert(canonicalProperty)
          .select("id")
          .single();
        if (propertyError || !createdProperty) throw new Error(propertyError?.message || "Property could not be prepared.");
        propertyId = String(createdProperty.id);
      } else {
        const { error: propertyUpdateError } = await client.from("properties")
          .update(canonicalProperty)
          .eq("id", propertyId);
        if (propertyUpdateError) throw new Error(propertyUpdateError.message);
      }
    }

    let requestId = String(lead.service_request_id || "");
    if (requestId) {
      const { data: updatedRequest, error: requestError } = await client.from("service_requests").update({
        company_id: body.companyId,
        organization_id: body.companyId,
        customer_id: customerId,
        property_id: propertyId || null,
        service_name: lead.service_requested || "Property service",
        message: body.message,
        status: "quoted",
      }).eq("id", requestId).select("id").maybeSingle();
      if (requestError) throw new Error(requestError.message);
      requestId = String(updatedRequest?.id || "");
    }

    if (!requestId) {
      const { data: createdRequest, error: requestError } = await client.from("service_requests").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        customer_id: customerId,
        property_id: propertyId || null,
        service_name: lead.service_requested || "Property service",
        message: body.message,
        status: "quoted",
      }).select("id").single();
      if (requestError || !createdRequest) throw new Error(requestError?.message || "Service Request could not be prepared.");
      requestId = String(createdRequest.id);
    }

    let quoteId = String(lead.quote_id || "");
    let quoteNumberValue = "";
    if (quoteId) {
      const { data: updatedQuote, error: quoteError } = await client.from("quotes").update({
        organization_id: body.companyId,
        company_id: body.companyId,
        request_id: requestId,
        customer_id: customerId,
        property_id: propertyId || null,
        // Draft is deliberate: company acceptance promotes it to sent.
        status: "draft",
        subtotal,
        tax,
        total,
        notes,
        customer_email: email,
        revision_note: body.message,
        master_reviewed_at: new Date().toISOString(),
        customer_decided_at: null,
      }).eq("id", quoteId).select("id,quote_number").maybeSingle();
      if (quoteError) throw new Error(quoteError.message);
      quoteId = String(updatedQuote?.id || "");
      quoteNumberValue = String(updatedQuote?.quote_number || "");
    }

    if (!quoteId) {
      const { count } = await client.from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("company_id", body.companyId);
      const { data: createdQuote, error: quoteError } = await client.from("quotes").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        request_id: requestId,
        customer_id: customerId,
        property_id: propertyId || null,
        quote_number: quoteNumber(count || 0),
        status: "draft",
        subtotal,
        tax,
        total,
        notes,
        customer_email: email,
        revision_note: body.message,
        master_reviewed_at: new Date().toISOString(),
      }).select("id,quote_number").single();
      if (quoteError || !createdQuote) throw new Error(quoteError?.message || "Quote could not be prepared.");
      quoteId = String(createdQuote.id);
      quoteNumberValue = String(createdQuote.quote_number);
    }

    // Deliberately no Auth invite/recovery here. The company acceptance endpoint
    // releases Customer access after respond_company_referral reaches converted.
    const leadPatch = {
      assigned_company_id: body.companyId,
      customer_id: customerId,
      property_id: propertyId || null,
      service_request_id: requestId,
      quote_id: quoteId,
      invoice_id: null,
      final_total: total,
      response_message: body.message,
      status: "offered",
      notes,
      responded_at: new Date().toISOString(),
      invite_sent_at: null,
      updated_at: new Date().toISOString(),
    };
    const { error: leadUpdateError } = await client.from("lead_center")
      .update(leadPatch)
      .eq("id", leadId);
    if (leadUpdateError) throw new Error(leadUpdateError.message);

    const { error: auditError } = await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: body.companyId,
      action: "lead.quote_prepared_for_company",
      entity_type: "lead_center",
      entity_id: leadId,
      details: {
        customer_id: customerId,
        property_id: propertyId || null,
        quote_id: quoteId,
        quote_status: "draft",
        invoice_created: false,
        job_created: false,
        customer_access_released: false,
        property_details_saved: Boolean(quoteDetails),
        next_step: "company_acceptance",
      },
    });
    if (auditError) throw new Error(auditError.message);

    return NextResponse.json({
      customerId,
      propertyId: propertyId || null,
      quoteId,
      quoteNumber: quoteNumberValue,
      invoiceId: null,
      inviteSent: false,
      accessMethod: "pending_company_acceptance",
      message: `Quote prepared for ${company.name}. The company must accept the referral before Customer access is released. No Job or Invoice has been created.`,
    });
  } catch (error) {
    return fail(error);
  }
}
