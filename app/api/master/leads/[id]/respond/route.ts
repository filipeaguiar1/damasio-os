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
  const { data: profile, error: profileError } = await client.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only Master can send quote responses.");
  return { client, masterId: auth.user.id };
}

function quoteNumber(count: number) { return `EST-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`; }
function invoiceNumber(count: number) { return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`; }
function temporaryPassword() { return `FourSeasons!${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`; }

async function findAuthUserByEmail(client: any, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const user = data?.users?.find((item: { email?: string }) => item.email?.toLowerCase() === email);
    if (user) return user;
    if (!data?.users?.length || data.users.length < 1000) return null;
  }
  return null;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  let invitedUserId = "";
  try {
    const leadId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leadId)) throw new Error("Choose a valid lead.");
    const body = schema.parse(await request.json());
    const { client, masterId } = await requireMaster(request);

    const { data: lead, error: leadError } = await client.from("lead_center").select("*").eq("id", leadId).maybeSingle();
    if (leadError || !lead) throw new Error(leadError?.message || "Lead not found.");
    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) throw new Error("This lead needs an email before it can receive a response.");

    const { data: company, error: companyError } = await client.from("organizations").select("id,name,active").eq("id", body.companyId).maybeSingle();
    if (companyError || !company?.active) throw new Error(companyError?.message || "Choose an active company.");

    const subtotal = Math.round((body.finalTotal / 1.13) * 100) / 100;
    const tax = Math.round((body.finalTotal - subtotal) * 100) / 100;
    const total = Math.round(body.finalTotal * 100) / 100;
    const notes = [lead.notes, `Master response: ${body.message}`, `Final quoted amount: $${total.toFixed(2)}`].filter(Boolean).join(" | ");

    const { data: existingCustomer } = await client.from("customers").select("id,profile_id").eq("company_id", body.companyId).ilike("email", email).maybeSingle();
    let customerId = existingCustomer?.id;
    let profileId = existingCustomer?.profile_id || "";
    if (!customerId) {
      const { data: createdCustomer, error: customerError } = await client.from("customers").insert({ organization_id: body.companyId, company_id: body.companyId, full_name: lead.full_name, email, phone: lead.phone || null, notes }).select("id,profile_id").single();
      if (customerError) throw new Error(customerError.message);
      customerId = createdCustomer.id;
      profileId = createdCustomer.profile_id || "";
    } else {
      await client.from("customers").update({ full_name: lead.full_name, phone: lead.phone || null, notes }).eq("id", customerId);
    }

    const { data: existingProperty } = await client.from("properties").select("id").eq("company_id", body.companyId).eq("customer_id", customerId).eq("address_line1", lead.address || "").maybeSingle();
    let propertyId = existingProperty?.id;
    if (!propertyId && String(lead.address || "").trim()) {
      const { data: property, error: propertyError } = await client.from("properties").insert({ organization_id: body.companyId, company_id: body.companyId, customer_id: customerId, address_line1: lead.address, city: "Hamilton", province: "ON", country: "Canada" }).select("id").single();
      if (propertyError) throw new Error(propertyError.message);
      propertyId = property.id;
    }

    let requestRow = null;
    if (lead.service_request_id) {
      const { data: updatedRequest, error } = await client.from("service_requests").update({ company_id: body.companyId, organization_id: body.companyId, customer_id: customerId, property_id: propertyId || null, service_name: lead.service_requested || "Property service", message: body.message, status: "quoted" }).eq("id", lead.service_request_id).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      requestRow = updatedRequest;
    }
    if (!requestRow) {
      const { data: createdRequest, error } = await client.from("service_requests").insert({ organization_id: body.companyId, company_id: body.companyId, customer_id: customerId, property_id: propertyId || null, service_name: lead.service_requested || "Property service", message: body.message, status: "quoted" }).select("id").single();
      if (error) throw new Error(error.message);
      requestRow = createdRequest;
    }

    let quote = null;
    if (lead.quote_id) {
      const { data, error } = await client.from("quotes").update({ organization_id: body.companyId, company_id: body.companyId, request_id: requestRow.id, customer_id: customerId, property_id: propertyId || null, status: "sent", subtotal, tax, total, notes, customer_email: email, revision_note: body.message, master_reviewed_at: new Date().toISOString() }).eq("id", lead.quote_id).select("id,quote_number").maybeSingle();
      if (error) throw new Error(error.message);
      quote = data;
    }
    if (!quote) {
      const { count } = await client.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", body.companyId);
      const { data, error } = await client.from("quotes").insert({ organization_id: body.companyId, company_id: body.companyId, request_id: requestRow.id, customer_id: customerId, property_id: propertyId || null, quote_number: quoteNumber(count || 0), status: "sent", subtotal, tax, total, notes, customer_email: email, revision_note: body.message, master_reviewed_at: new Date().toISOString() }).select("id,quote_number").single();
      if (error) throw new Error(error.message);
      quote = data;
    }

    let invoice = null;
    if (lead.invoice_id) {
      const { data, error } = await client.from("invoices").update({ organization_id: body.companyId, company_id: body.companyId, quote_id: quote.id, customer_id: customerId, property_id: propertyId || null, status: "waiting_payment", subtotal, tax, total }).eq("id", lead.invoice_id).select("id,invoice_number").maybeSingle();
      if (error) throw new Error(error.message);
      invoice = data;
    }
    if (!invoice) {
      const { count } = await client.from("invoices").select("id", { count: "exact", head: true }).eq("company_id", body.companyId);
      const { data, error } = await client.from("invoices").insert({ organization_id: body.companyId, company_id: body.companyId, quote_id: quote.id, customer_id: customerId, property_id: propertyId || null, invoice_number: invoiceNumber(count || 0), status: "waiting_payment", subtotal, tax, total }).select("id,invoice_number").single();
      if (error) throw new Error(error.message);
      invoice = data;
    }

    let inviteSent = false;
    let accessMethod: "invite" | "recovery" | "temporary_password" | "none" = "none";
    let generatedPassword = "";
    if (body.sendInvite) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
      const redirectTo = `${siteUrl}/auth/complete?quote=${encodeURIComponent(quote.quote_number)}`;
      const metadata = { full_name: lead.full_name, role: "customer", company_id: body.companyId, customer_id: customerId, quote_id: quote.id, invoice_id: invoice.id };
      const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, { redirectTo, data: metadata });

      if (!inviteError && invite.user) {
        invitedUserId = invite.user.id;
        profileId = invite.user.id;
        inviteSent = true;
        accessMethod = "invite";
      } else {
        const existingUser = await findAuthUserByEmail(client, email);
        if (existingUser) {
          profileId = existingUser.id;
          const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/reset-password?quote=${encodeURIComponent(quote.quote_number)}` });
          if (!recoveryError) {
            inviteSent = true;
            accessMethod = "recovery";
          } else {
            generatedPassword = temporaryPassword();
            const { error: passwordError } = await client.auth.admin.updateUserById(existingUser.id, { password: generatedPassword, email_confirm: true, user_metadata: metadata });
            if (passwordError) throw new Error(passwordError.message);
            accessMethod = "temporary_password";
          }
        } else {
          generatedPassword = temporaryPassword();
          const { data: created, error: createError } = await client.auth.admin.createUser({ email, password: generatedPassword, email_confirm: true, user_metadata: metadata });
          if (createError || !created.user) throw new Error(createError?.message || inviteError?.message || "Customer access could not be created.");
          profileId = created.user.id;
          accessMethod = "temporary_password";
        }
      }

      const { error: profileError } = await client.from("profiles").upsert({ id: profileId, organization_id: body.companyId, company_id: body.companyId, role: "customer", full_name: lead.full_name, email, phone: lead.phone || null, active: true }, { onConflict: "id" });
      if (profileError) throw new Error(profileError.message);
      await client.from("customers").update({ profile_id: profileId }).eq("id", customerId);
      await client.from("quote_invitations").upsert({ company_id: body.companyId, quote_id: quote.id, email, status: inviteSent ? "sent" : "pending", sent_at: inviteSent ? new Date().toISOString() : null, expires_at: new Date(Date.now() + 14 * 86400000).toISOString() }, { onConflict: "quote_id,email" });
    }

    const leadPatch = { assigned_company_id: body.companyId, customer_id: customerId, property_id: propertyId || null, service_request_id: requestRow.id, quote_id: quote.id, invoice_id: invoice.id, final_total: total, response_message: body.message, status: "offered", notes, responded_at: new Date().toISOString(), invite_sent_at: inviteSent ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    const leadUpdate = await client.from("lead_center").update(leadPatch).eq("id", leadId);
    if (leadUpdate.error) await client.from("lead_center").update({ assigned_company_id: body.companyId, status: "offered", notes, updated_at: new Date().toISOString() }).eq("id", leadId);

    await client.from("master_audit_log").insert({ master_profile_id: masterId, company_id: body.companyId, action: "lead.response_sent", entity_type: "lead_center", entity_id: leadId, details: { customer_id: customerId, property_id: propertyId, quote_id: quote.id, invoice_id: invoice.id, invite_sent: inviteSent, access_method: accessMethod } });

    const message = accessMethod === "invite"
      ? `Invitation sent to ${email}.`
      : accessMethod === "recovery"
        ? `Password setup link sent to ${email}.`
        : accessMethod === "temporary_password"
          ? `Email delivery was unavailable. Temporary password for ${email}: ${generatedPassword}`
          : "Response saved and invoice prepared.";

    return NextResponse.json({ customerId, propertyId, quoteId: quote.id, quoteNumber: quote.quote_number, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, inviteSent, accessMethod, temporaryPassword: generatedPassword || undefined, message });
  } catch (error) {
    if (invitedUserId) {
      try { await serverClient().auth.admin.deleteUser(invitedUserId); } catch {}
    }
    return fail(error);
  }
}
