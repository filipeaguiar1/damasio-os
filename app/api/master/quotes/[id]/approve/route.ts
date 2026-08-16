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
  if (!url || !key) throw new Error("Quote sending is not configured on the server.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Quote sending failed." }, { status });
}

async function requireQuoteSender(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as an administrator.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles")
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

async function findAuthUserByEmail(client: ReturnType<typeof serverClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = data.users.find((item: any) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

async function ensureCustomerProfile(
  client: ReturnType<typeof serverClient>,
  input: {
    userId: string;
    customerId: string;
    companyId: string;
    fullName: string;
    email: string;
    phone?: string | null;
  },
) {
  const { data: existing, error: existingError } = await client.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && existing.role !== "customer") {
    throw new Error("This email already belongs to a staff login and cannot be reused as a Customer.");
  }
  const existingCompanyId = existing?.company_id || existing?.organization_id;
  if (existingCompanyId && String(existingCompanyId) !== input.companyId) {
    throw new Error("This Customer login is already linked to another company.");
  }

  const { data: customer, error: customerLookupError } = await client.from("customers")
    .select("id,profile_id")
    .eq("id", input.customerId)
    .maybeSingle();
  if (customerLookupError || !customer) throw new Error(customerLookupError?.message || "Customer not found.");
  if (customer.profile_id && String(customer.profile_id) !== input.userId) {
    throw new Error("This Customer record is already linked to another login.");
  }

  const { error: profileError } = await client.from("profiles").upsert({
    id: input.userId,
    organization_id: input.companyId,
    company_id: input.companyId,
    role: "customer",
    full_name: input.fullName,
    email: input.email,
    phone: input.phone || null,
    active: true,
  }, { onConflict: "id" });
  if (profileError) throw new Error(profileError.message);

  const { error: customerError } = await client.from("customers")
    .update({ profile_id: input.userId })
    .eq("id", input.customerId)
    .is("archived_at", null);
  if (customerError) throw new Error(customerError.message);
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  let createdUserId = "";
  try {
    const quoteId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quoteId)) throw new Error("Choose a valid quote.");
    const body = approvalSchema.parse(await request.json());
    const { client, actorId, role, companyId: actorCompanyId } = await requireQuoteSender(request);

    const { data: quote, error: quoteError } = await client.from("quotes")
      .select("id,quote_number,status,customer_id,property_id,company_id,organization_id,customers(id,full_name,email,phone,profile_id)")
      .eq("id", quoteId)
      .maybeSingle();
    if (quoteError || !quote) throw new Error(quoteError?.message || "Quote not found.");

    const quoteCompanyId = String(quote.company_id || quote.organization_id || "");
    if (!quoteCompanyId) throw new Error("Quote is not linked to a company.");
    if (role === "admin" && String(actorCompanyId || "") !== quoteCompanyId) {
      throw new Error("This quote belongs to another company.");
    }
    if (["declined", "expired", "approved"].includes(String(quote.status))) {
      throw new Error("A quote with a final Customer decision cannot be resent as a new quote.");
    }

    const customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers;
    const customerId = String(quote.customer_id || customer?.id || "");
    const email = String(customer?.email || "").trim().toLowerCase();
    const fullName = String(customer?.full_name || "Customer").trim();
    if (!customerId || !email) throw new Error("This quote needs a canonical Customer and email before it can be sent.");

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
      customer_decided_at: null,
    }).eq("id", quote.id).eq("organization_id", quoteCompanyId);
    if (updateQuoteError) throw new Error(updateQuoteError.message);

    let inviteSent = false;
    let accessMethod: "existing" | "invitation" | "recovery" | "none" = customer?.profile_id ? "existing" : "none";
    let userId = String(customer?.profile_id || "");

    if (body.sendInvite) {
      const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");

      if (userId) {
        await ensureCustomerProfile(client, {
          userId,
          customerId,
          companyId: quoteCompanyId,
          fullName,
          email,
          phone: customer?.phone,
        });
        accessMethod = "existing";
      } else {
        const existingUser = await findAuthUserByEmail(client, email);
        if (existingUser) {
          userId = existingUser.id;
          await ensureCustomerProfile(client, {
            userId,
            customerId,
            companyId: quoteCompanyId,
            fullName,
            email,
            phone: customer?.phone,
          });
          const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: `${siteUrl}/reset-password?onboarding=customer&quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
          });
          if (recoveryError) throw new Error(`Customer recovery email could not be sent: ${recoveryError.message}`);
          inviteSent = true;
          accessMethod = "recovery";
        } else {
          const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${siteUrl}/auth/complete?quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
            data: { full_name: fullName },
          });
          if (inviteError || !invite.user) throw new Error(inviteError?.message || "Customer invitation could not be created.");
          userId = invite.user.id;
          createdUserId = userId;
          await ensureCustomerProfile(client, {
            userId,
            customerId,
            companyId: quoteCompanyId,
            fullName,
            email,
            phone: customer?.phone,
          });
          inviteSent = true;
          accessMethod = "invitation";
        }
      }

      const invitationStatus = accessMethod === "existing" ? "claimed" : inviteSent ? "sent" : "pending";
      const { error: invitationError } = await client.from("quote_invitations").upsert({
        company_id: quoteCompanyId,
        quote_id: quote.id,
        email,
        status: invitationStatus,
        sent_at: inviteSent ? new Date().toISOString() : null,
        claimed_by: accessMethod === "existing" ? userId : null,
        claimed_at: accessMethod === "existing" ? new Date().toISOString() : null,
        expires_at: accessMethod === "existing" ? null : new Date(Date.now() + 14 * 86400000).toISOString(),
      }, { onConflict: "quote_id,email" });
      if (invitationError) throw new Error(invitationError.message);
    }

    const { error: activityError } = await client.from("activity_log").insert({
      organization_id: quoteCompanyId,
      company_id: quoteCompanyId,
      actor_profile_id: actorId,
      action: "quote.sent_to_customer",
      entity_type: "quote",
      entity_id: quote.id,
      details: `Quote ${quote.quote_number} sent for $${total.toFixed(2)}. No Invoice or Job was created before Customer approval.`,
    });
    if (activityError) throw new Error(activityError.message);

    const message = accessMethod === "invitation"
      ? `Quote sent and Customer invitation delivered to ${email}.`
      : accessMethod === "recovery"
        ? `Quote sent and Customer recovery link delivered to ${email}.`
        : accessMethod === "existing"
          ? "Quote sent to the existing Customer account."
          : "Quote sent. No Customer access email was requested.";

    return NextResponse.json({
      quoteId: quote.id,
      invoiceId: null,
      inviteSent,
      accessMethod,
      message,
    });
  } catch (error) {
    if (createdUserId) {
      try { await serverClient().auth.admin.deleteUser(createdUserId); } catch {}
    }
    return failure(error);
  }
}
