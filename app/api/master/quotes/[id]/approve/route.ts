import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const approvalSchema = z.object({
  finalTotal: z.number().positive().max(100000),
  revisionNote: z.string().trim().max(1200).optional().default(""),
  sendInvite: z.boolean().optional().default(true),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Quote approval is not configured on the server.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Quote approval failed." }, { status });
}

async function requireMasterAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the Master Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile?.active || profile.role !== "master") {
    throw new Error("Only the Master Admin can approve and invite new quote customers.");
  }
  return { client, masterId: auth.user.id };
}

function invoiceNumber(count: number) {
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  let invitedUserId = "";
  try {
    const quoteId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quoteId)) throw new Error("Choose a valid quote.");
    const body = approvalSchema.parse(await request.json());
    const { client, masterId } = await requireMasterAdmin(request);

    const { data: quote, error: quoteError } = await client
      .from("quotes")
      .select("id,quote_number,status,customer_id,property_id,company_id,organization_id,customers(id,full_name,email,phone,profile_id)")
      .eq("id", quoteId)
      .maybeSingle();
    if (quoteError || !quote) throw new Error(quoteError?.message || "Quote not found.");
    const quoteCompanyId = quote.company_id || quote.organization_id;
    if (!quoteCompanyId) throw new Error("Quote is not linked to a company.");
    if (quote.status === "declined" || quote.status === "expired") throw new Error("Closed quotes cannot be approved.");

    const customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers;
    const email = String(customer?.email || "").trim().toLowerCase();
    const fullName = String(customer?.full_name || "Customer").trim();
    if (!email) throw new Error("This quote needs a customer email before it can be sent.");

    const subtotal = Math.round((body.finalTotal / 1.13) * 100) / 100;
    const tax = Math.round((body.finalTotal - subtotal) * 100) / 100;
    const total = Math.round(body.finalTotal * 100) / 100;

    const { error: updateQuoteError } = await client
      .from("quotes")
      .update({
        status: "sent",
        subtotal,
        tax,
        total,
        customer_email: email,
        revision_note: body.revisionNote || null,
        master_reviewed_at: new Date().toISOString(),
      })
      .eq("id", quote.id)
      .or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
    if (updateQuoteError) throw new Error(updateQuoteError.message);

    const { data: existingInvoice } = await client
      .from("invoices")
      .select("id,invoice_number")
      .eq("quote_id", quote.id)
      .or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`)
      .maybeSingle();
    let invoice = existingInvoice;
    if (!invoice) {
      const { count } = await client
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      const { data: createdInvoice, error: invoiceError } = await client
        .from("invoices")
        .insert({
          company_id: quoteCompanyId,
          organization_id: quoteCompanyId,
          quote_id: quote.id,
          customer_id: quote.customer_id,
          property_id: quote.property_id,
          invoice_number: invoiceNumber(count || 0),
          status: "waiting_payment",
          subtotal,
          tax,
          total,
        })
        .select("id,invoice_number")
        .single();
      if (invoiceError) throw new Error(invoiceError.message);
      invoice = createdInvoice;
    } else {
      const { error: invoiceUpdateError } = await client
        .from("invoices")
        .update({ status: "waiting_payment", subtotal, tax, total })
        .eq("id", invoice.id)
        .or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      if (invoiceUpdateError) throw new Error(invoiceUpdateError.message);
    }

    let inviteSent = false;
    if (body.sendInvite) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
      const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/auth/complete?quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
        data: { full_name: fullName, role: "customer", company_id: quoteCompanyId, customer_id: quote.customer_id, quote_id: quote.id },
      });
      if (inviteError || !invite.user) throw new Error(inviteError?.message || "Customer invitation could not be created.");
      invitedUserId = invite.user.id;
      inviteSent = true;

      const { error: profileError } = await client.from("profiles").upsert({
        id: invitedUserId,
        organization_id: quoteCompanyId,
        company_id: quoteCompanyId,
        role: "customer",
        full_name: fullName,
        email,
        phone: customer?.phone || null,
        active: true,
      }, { onConflict: "id" });
      if (profileError) throw new Error(profileError.message);

      const { error: customerError } = await client
        .from("customers")
        .update({ profile_id: invitedUserId })
        .eq("id", quote.customer_id)
        .or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      if (customerError) throw new Error(customerError.message);

      await client.from("quote_invitations").upsert({
        company_id: quoteCompanyId,
        quote_id: quote.id,
        email,
        status: "sent",
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      }, { onConflict: "quote_id,email" });
    }

    await client.from("activity_log").insert({
      organization_id: quoteCompanyId,
      company_id: quoteCompanyId,
      actor_profile_id: masterId,
      action: "quote.master_approved_for_customer",
      entity_type: "quote",
      entity_id: quote.id,
      details: `Master approved quote ${quote.quote_number} for $${total.toFixed(2)}. Invoice ${invoice?.invoice_number || ""} is waiting payment.`,
    });

    return NextResponse.json({
      quoteId: quote.id,
      invoiceId: invoice?.id,
      invoiceNumber: invoice?.invoice_number,
      inviteSent,
      message: inviteSent ? `Quote approved by Master and invitation sent to ${email}.` : "Quote approved by Master and invoice prepared.",
    });
  } catch (error) {
    if (invitedUserId) {
      try { await serverClient().auth.admin.deleteUser(invitedUserId); } catch {}
    }
    return failure(error);
  }
}
