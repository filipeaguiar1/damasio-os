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

async function requireQuoteSender(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as an administrator.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile?.active || !["master", "admin"].includes(profile.role)) {
    throw new Error("Only an active Master or company Admin can send a quote.");
  }
  return {
    client,
    actorId: auth.user.id,
    role: profile.role as "master" | "admin",
    companyId: profile.company_id || profile.organization_id || null,
  };
}

function invoiceNumber(count: number) {
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`;
}

function temporaryPassword() {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `Temp-${random}!9`;
}

async function findAuthUserByEmail(client: ReturnType<typeof serverClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  let createdUserId = "";
  try {
    const quoteId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quoteId)) throw new Error("Choose a valid quote.");
    const body = approvalSchema.parse(await request.json());
    const { client, actorId, role, companyId: actorCompanyId } = await requireQuoteSender(request);

    const { data: quote, error: quoteError } = await client
      .from("quotes")
      .select("id,quote_number,status,customer_id,property_id,company_id,organization_id,customers(id,full_name,email,phone,profile_id)")
      .eq("id", quoteId)
      .maybeSingle();
    if (quoteError || !quote) throw new Error(quoteError?.message || "Quote not found.");

    const quoteCompanyId = quote.company_id || quote.organization_id;
    if (!quoteCompanyId) throw new Error("Quote is not linked to a company.");
    if (role === "admin" && actorCompanyId !== quoteCompanyId) throw new Error("This quote belongs to another company.");
    if (["declined", "expired"].includes(quote.status)) throw new Error("Closed quotes cannot be sent.");

    const customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers;
    const email = String(customer?.email || "").trim().toLowerCase();
    const fullName = String(customer?.full_name || "Customer").trim();
    if (!email) throw new Error("This quote needs a customer email before it can be sent.");

    const subtotal = Math.round((body.finalTotal / 1.13) * 100) / 100;
    const tax = Math.round((body.finalTotal - subtotal) * 100) / 100;
    const total = Math.round(body.finalTotal * 100) / 100;

    const { error: updateQuoteError } = await client.from("quotes").update({
      status: "sent",
      subtotal,
      tax,
      total,
      customer_email: email,
      revision_note: body.revisionNote || null,
      master_reviewed_at: new Date().toISOString(),
    }).eq("id", quote.id).or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
    if (updateQuoteError) throw new Error(updateQuoteError.message);

    const { data: existingInvoice } = await client.from("invoices").select("id,invoice_number").eq("quote_id", quote.id).or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`).maybeSingle();
    let invoice = existingInvoice;
    if (!invoice) {
      const { count } = await client.from("invoices").select("id", { count: "exact", head: true }).or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      const { data: createdInvoice, error: invoiceError } = await client.from("invoices").insert({
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
      }).select("id,invoice_number").single();
      if (invoiceError) throw new Error(invoiceError.message);
      invoice = createdInvoice;
    } else {
      const { error: invoiceUpdateError } = await client.from("invoices").update({ status: "waiting_payment", subtotal, tax, total }).eq("id", invoice.id).or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      if (invoiceUpdateError) throw new Error(invoiceUpdateError.message);
    }

    let inviteSent = false;
    let tempPassword = "";
    let userId = String(customer?.profile_id || "");

    if (body.sendInvite) {
      const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
      const existingUser = userId ? null : await findAuthUserByEmail(client, email);
      if (existingUser) userId = existingUser.id;

      if (userId) {
        const { error: updateUserError } = await client.auth.admin.updateUserById(userId, {
          user_metadata: { full_name: fullName, role: "customer", company_id: quoteCompanyId, customer_id: quote.customer_id, quote_id: quote.id },
        });
        if (updateUserError) throw new Error(updateUserError.message);

        const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/reset-password?onboarding=customer&quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
        });
        if (resetError) {
          if (!resetError.message.toLowerCase().includes("rate limit")) throw new Error(resetError.message);
          tempPassword = temporaryPassword();
          const { error: passwordError } = await client.auth.admin.updateUserById(userId, { password: tempPassword, email_confirm: true });
          if (passwordError) throw new Error(passwordError.message);
        } else inviteSent = true;
      } else {
        const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${siteUrl}/auth/complete?quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
          data: { full_name: fullName, role: "customer", company_id: quoteCompanyId, customer_id: quote.customer_id, quote_id: quote.id },
        });

        if (inviteError || !invite.user) {
          if (!inviteError?.message?.toLowerCase().includes("rate limit")) throw new Error(inviteError?.message || "Customer invitation could not be created.");
          tempPassword = temporaryPassword();
          const { data: created, error: createError } = await client.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName, role: "customer", company_id: quoteCompanyId, customer_id: quote.customer_id, quote_id: quote.id },
          });
          if (createError || !created.user) throw new Error(createError?.message || "Customer account could not be created.");
          userId = created.user.id;
          createdUserId = userId;
        } else {
          userId = invite.user.id;
          createdUserId = userId;
          inviteSent = true;
        }
      }

      const { error: profileError } = await client.from("profiles").upsert({
        id: userId,
        organization_id: quoteCompanyId,
        company_id: quoteCompanyId,
        role: "customer",
        full_name: fullName,
        email,
        phone: customer?.phone || null,
        active: true,
      }, { onConflict: "id" });
      if (profileError) throw new Error(profileError.message);

      const { error: customerError } = await client.from("customers").update({ profile_id: userId }).eq("id", quote.customer_id).or(`company_id.eq.${quoteCompanyId},organization_id.eq.${quoteCompanyId}`);
      if (customerError) throw new Error(customerError.message);

      await client.from("quote_invitations").upsert({
        company_id: quoteCompanyId,
        quote_id: quote.id,
        email,
        status: inviteSent ? "sent" : "temporary_password",
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      }, { onConflict: "quote_id,email" });
    }

    await client.from("activity_log").insert({
      organization_id: quoteCompanyId,
      company_id: quoteCompanyId,
      actor_profile_id: actorId,
      action: "quote.sent_to_customer",
      entity_type: "quote",
      entity_id: quote.id,
      details: `Quote ${quote.quote_number} sent for $${total.toFixed(2)}. Invoice ${invoice?.invoice_number || ""} is waiting payment.`,
    });

    const message = tempPassword
      ? `Quote sent and customer account prepared. Email delivery is limited, so use temporary password ${tempPassword} with ${email}.`
      : inviteSent
        ? `Quote sent and customer access email delivered to ${email}.`
        : "Quote sent and invoice prepared.";

    return NextResponse.json({ quoteId: quote.id, invoiceId: invoice?.id, invoiceNumber: invoice?.invoice_number, inviteSent, temporaryPassword: tempPassword || undefined, message });
  } catch (error) {
    if (createdUserId) {
      try { await serverClient().auth.admin.deleteUser(createdUserId); } catch {}
    }
    return failure(error);
  }
}
