import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  companyId: z.string().uuid(),
  finalTotal: z.number().positive().max(100000),
  message: z.string().trim().min(2).max(1500),
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
    throw new Error("Only Master can send quote responses.");
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
    typeof details.annual === "boolean" ? `Annual plan: ${details.annual ? "Yes" : "No"}` : null,
  ].filter(Boolean).join(" | ") || null;
  return {
    lot_size: details.lawnSize || null,
    grass_height: details.grassHeight || null,
    gate: Boolean(details.gated),
    property_notes: propertyNotes,
  };
}

async function findAuthUserByEmail(client: any, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const user = data?.users?.find((item: { email?: string }) => item.email?.toLowerCase() === email);
    if (user) return user;
    if (!data?.users?.length || data.users.length < 1000) return null;
  }
  return null;
}

async function ensureCustomerProfile(
  client: any,
  profileId: string,
  companyId: string,
  customerId: string,
  lead: any,
  email: string,
) {
  const existing = await client.from("profiles")
    .select("id,role,active,company_id,organization_id,email")
    .eq("id", profileId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data && existing.data.role !== "customer") {
    throw new Error("This email already belongs to a staff account and cannot be linked as a Customer.");
  }
  const profileCompanyId = existing.data?.company_id || existing.data?.organization_id;
  if (profileCompanyId && String(profileCompanyId) !== companyId) {
    throw new Error("This Customer login already belongs to a different company.");
  }

  const { error: profileError } = await client.from("profiles").upsert({
    id: profileId,
    organization_id: companyId,
    company_id: companyId,
    role: "customer",
    full_name: lead.full_name,
    email,
    phone: lead.phone || null,
    active: true,
  }, { onConflict: "id" });
  if (profileError) throw new Error(profileError.message);

  const { error: customerLinkError } = await client.from("customers")
    .update({ profile_id: profileId })
    .eq("id", customerId)
    .is("archived_at", null);
  if (customerLinkError) throw new Error(customerLinkError.message);
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  let newlyInvitedUserId = "";
  try {
    const leadId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leadId)) throw new Error("Choose a valid lead.");
    const body = schema.parse(await request.json());
    const { client, masterId } = await requireMaster(request);

    const { data: lead, error: leadError } = await client.from("lead_center").select("*").eq("id", leadId).maybeSingle();
    if (leadError || !lead) throw new Error(leadError?.message || "Lead not found.");
    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) throw new Error("This lead needs an email before it can receive a response.");

    const { data: company, error: companyError } = await client.from("organizations")
      .select("id,name,active")
      .eq("id", body.companyId)
      .maybeSingle();
    if (companyError || !company?.active) throw new Error(companyError?.message || "Choose an active company.");

    const subtotal = Math.round((body.finalTotal / 1.13) * 100) / 100;
    const tax = Math.round((body.finalTotal - subtotal) * 100) / 100;
    const total = Math.round(body.finalTotal * 100) / 100;
    const quoteDetails = extractPropertyDetails(lead.notes);
    const publicNotes = cleanLeadNotes(lead.notes);
    const notes = [publicNotes, `Master response: ${body.message}`, `Final quoted amount: $${total.toFixed(2)}`]
      .filter(Boolean)
      .join(" | ");

    const { data: existingCustomer, error: existingCustomerError } = await client.from("customers")
      .select("id,profile_id")
      .eq("company_id", body.companyId)
      .ilike("email", email)
      .is("archived_at", null)
      .maybeSingle();
    if (existingCustomerError) throw new Error(existingCustomerError.message);

    let customerId = existingCustomer?.id || "";
    let profileId = existingCustomer?.profile_id || "";
    if (!customerId) {
      const { data: createdCustomer, error: customerError } = await client.from("customers").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        full_name: lead.full_name,
        email,
        phone: lead.phone || null,
        notes,
      }).select("id,profile_id").single();
      if (customerError) throw new Error(customerError.message);
      customerId = createdCustomer.id;
      profileId = createdCustomer.profile_id || "";
    } else {
      const { error } = await client.from("customers")
        .update({ full_name: lead.full_name, phone: lead.phone || null, notes })
        .eq("id", customerId);
      if (error) throw new Error(error.message);
    }

    const { data: existingProperty, error: existingPropertyError } = await client.from("properties")
      .select("id")
      .eq("company_id", body.companyId)
      .eq("customer_id", customerId)
      .eq("address_line1", lead.address || "")
      .maybeSingle();
    if (existingPropertyError) throw new Error(existingPropertyError.message);

    let propertyId = existingProperty?.id || "";
    const canonicalProperty = {
      organization_id: body.companyId,
      company_id: body.companyId,
      customer_id: customerId,
      address_line1: lead.address,
      city: "Hamilton",
      province: "ON",
      country: "Canada",
      ...propertyValues(quoteDetails),
    };
    if (!propertyId && String(lead.address || "").trim()) {
      const { data: property, error: propertyError } = await client.from("properties")
        .insert(canonicalProperty)
        .select("id")
        .single();
      if (propertyError) throw new Error(propertyError.message);
      propertyId = property.id;
    } else if (propertyId) {
      const { error: propertyError } = await client.from("properties").update(canonicalProperty).eq("id", propertyId);
      if (propertyError) throw new Error(propertyError.message);
    }

    let requestRow: { id: string } | null = null;
    if (lead.service_request_id) {
      const { data, error } = await client.from("service_requests").update({
        company_id: body.companyId,
        organization_id: body.companyId,
        customer_id: customerId,
        property_id: propertyId || null,
        service_name: lead.service_requested || "Property service",
        message: body.message,
        status: "quoted",
      }).eq("id", lead.service_request_id).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      requestRow = data;
    }
    if (!requestRow) {
      const { data, error } = await client.from("service_requests").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        customer_id: customerId,
        property_id: propertyId || null,
        service_name: lead.service_requested || "Property service",
        message: body.message,
        status: "quoted",
      }).select("id").single();
      if (error) throw new Error(error.message);
      requestRow = data;
    }

    let quote: { id: string; quote_number: string } | null = null;
    if (lead.quote_id) {
      const { data, error } = await client.from("quotes").update({
        organization_id: body.companyId,
        company_id: body.companyId,
        request_id: requestRow.id,
        customer_id: customerId,
        property_id: propertyId || null,
        status: "sent",
        subtotal,
        tax,
        total,
        notes,
        customer_email: email,
        revision_note: body.message,
        master_reviewed_at: new Date().toISOString(),
      }).eq("id", lead.quote_id).select("id,quote_number").maybeSingle();
      if (error) throw new Error(error.message);
      quote = data;
    }
    if (!quote) {
      const { count } = await client.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", body.companyId);
      const { data, error } = await client.from("quotes").insert({
        organization_id: body.companyId,
        company_id: body.companyId,
        request_id: requestRow.id,
        customer_id: customerId,
        property_id: propertyId || null,
        quote_number: quoteNumber(count || 0),
        status: "sent",
        subtotal,
        tax,
        total,
        notes,
        customer_email: email,
        revision_note: body.message,
        master_reviewed_at: new Date().toISOString(),
      }).select("id,quote_number").single();
      if (error) throw new Error(error.message);
      quote = data;
    }

    let inviteSent = false;
    let accessMethod: "invite" | "recovery" | "existing" | "none" = profileId ? "existing" : "none";
    if (body.sendInvite) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
      const redirectTo = `${siteUrl}/auth/complete?quote=${encodeURIComponent(quote.quote_number)}`;

      if (!profileId) {
        const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { full_name: lead.full_name },
        });
        if (!inviteError && invite.user) {
          newlyInvitedUserId = invite.user.id;
          profileId = invite.user.id;
          inviteSent = true;
          accessMethod = "invite";
        } else {
          const existingUser = await findAuthUserByEmail(client, email);
          if (!existingUser) throw new Error(inviteError?.message || "Customer invitation could not be sent.");
          profileId = existingUser.id;
          await ensureCustomerProfile(client, profileId, body.companyId, customerId, lead, email);
          const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: `${siteUrl}/reset-password?quote=${encodeURIComponent(quote.quote_number)}`,
          });
          if (recoveryError) throw new Error(`Customer access exists, but recovery email failed: ${recoveryError.message}`);
          inviteSent = true;
          accessMethod = "recovery";
        }
      }

      if (profileId) {
        await ensureCustomerProfile(client, profileId, body.companyId, customerId, lead, email);
      }

      const { error: invitationError } = await client.from("quote_invitations").upsert({
        company_id: body.companyId,
        quote_id: quote.id,
        email,
        status: inviteSent || accessMethod === "existing" ? "sent" : "pending",
        sent_at: inviteSent ? new Date().toISOString() : null,
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      }, { onConflict: "quote_id,email" });
      if (invitationError) throw new Error(invitationError.message);
    }

    const leadPatch = {
      assigned_company_id: body.companyId,
      customer_id: customerId,
      property_id: propertyId || null,
      service_request_id: requestRow.id,
      quote_id: quote.id,
      final_total: total,
      response_message: body.message,
      status: "offered",
      notes,
      responded_at: new Date().toISOString(),
      invite_sent_at: inviteSent ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const leadUpdate = await client.from("lead_center").update(leadPatch).eq("id", leadId);
    if (leadUpdate.error) throw new Error(leadUpdate.error.message);

    const { error: auditError } = await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: body.companyId,
      action: "lead.response_sent",
      entity_type: "lead_center",
      entity_id: leadId,
      details: {
        customer_id: customerId,
        property_id: propertyId || null,
        quote_id: quote.id,
        invoice_created: false,
        invite_sent: inviteSent,
        access_method: accessMethod,
        property_details_saved: Boolean(quoteDetails),
        next_step: "company_acceptance_then_customer_quote_decision",
      },
    });
    if (auditError) throw new Error(auditError.message);

    const message = accessMethod === "invite"
      ? `Quote prepared and Customer invitation sent to ${email}. The company must accept before the Customer can approve the quote.`
      : accessMethod === "recovery"
        ? `Quote prepared and Customer recovery link sent to ${email}. The company must accept before quote approval.`
        : accessMethod === "existing"
          ? "Quote prepared for company acceptance. The existing Customer account remains linked."
          : "Quote prepared for company acceptance. No Invoice or Job has been created yet.";

    return NextResponse.json({
      customerId,
      propertyId: propertyId || null,
      quoteId: quote.id,
      quoteNumber: quote.quote_number,
      invoiceId: null,
      inviteSent,
      accessMethod,
      message,
    });
  } catch (error) {
    if (newlyInvitedUserId) {
      try { await serverClient().auth.admin.deleteUser(newlyInvitedUserId); } catch {}
    }
    return fail(error);
  }
}
