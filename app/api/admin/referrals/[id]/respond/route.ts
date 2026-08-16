import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function configured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Company referral response is not configured.");
  return { url, anonKey, serviceKey };
}

function serviceClient() {
  const { url, serviceKey } = configured();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function userClient(token: string) {
  const { url, anonKey } = configured();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

async function requireCompanyUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your company session expired. Sign in again.");
  const { data: profile, error: profileError } = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || !["admin", "manager"].includes(String(profile.role))) {
    throw new Error("Only an active company Admin or Manager can answer a referral.");
  }
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!companyId) throw new Error("Your account is not linked to a company.");
  return { token, service, actorId: auth.user.id, companyId };
}

async function findAuthUserByEmail(service: any, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = data.users.find((item: any) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
  }
  return null;
}

async function ensureCustomerProfile(
  service: any,
  input: {
    userId: string;
    companyId: string;
    customerId: string;
    fullName: string;
    email: string;
    phone?: string | null;
  },
) {
  const { data: existing, error: existingError } = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && existing.role !== "customer") {
    throw new Error("This email already belongs to a staff login and cannot be released as a Customer account.");
  }
  const existingCompanyId = existing?.company_id || existing?.organization_id;
  if (existingCompanyId && String(existingCompanyId) !== input.companyId) {
    throw new Error("This Customer login already belongs to another company.");
  }

  const { data: customer, error: customerError } = await service.from("customers")
    .select("id,profile_id")
    .eq("id", input.customerId)
    .is("archived_at", null)
    .maybeSingle();
  if (customerError || !customer) throw new Error(customerError?.message || "Canonical Customer not found.");
  if (customer.profile_id && String(customer.profile_id) !== input.userId) {
    throw new Error("This Customer is already linked to another login.");
  }

  const { error: profileError } = await service.from("profiles").upsert({
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

  const { error: linkError } = await service.from("customers")
    .update({ profile_id: input.userId })
    .eq("id", input.customerId)
    .is("archived_at", null);
  if (linkError) throw new Error(linkError.message);
}

function siteOrigin(request: NextRequest) {
  const configuredSite = String(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (configuredSite && !/localhost|127\.0\.0\.1/i.test(configuredSite)) return configuredSite;
  return request.nextUrl.origin;
}

async function releaseCustomerAccess(
  request: NextRequest,
  service: any,
  lead: any,
  companyId: string,
) {
  const customerId = String(lead.customer_id || "");
  const quoteId = String(lead.quote_id || "");
  const email = String(lead.email || "").trim().toLowerCase();
  if (!customerId || !quoteId || !email) {
    return { accessMethod: "pending" as const, inviteSent: false, warning: "Referral accepted, but Customer access is missing a canonical Customer, Quote, or email." };
  }

  const [{ data: customer, error: customerError }, { data: quote, error: quoteError }] = await Promise.all([
    service.from("customers").select("id,profile_id,full_name,email,phone").eq("id", customerId).is("archived_at", null).maybeSingle(),
    service.from("quotes").select("id,quote_number,status").eq("id", quoteId).maybeSingle(),
  ]);
  if (customerError || !customer) throw new Error(customerError?.message || "Canonical Customer not found after referral acceptance.");
  if (quoteError || !quote) throw new Error(quoteError?.message || "Canonical Quote not found after referral acceptance.");

  const fullName = String(customer.full_name || lead.full_name || "Customer").trim();
  const siteUrl = siteOrigin(request);
  let userId = String(customer.profile_id || "");
  let accessMethod: "existing" | "invitation" | "recovery" | "pending" = userId ? "existing" : "pending";
  let inviteSent = false;
  let warning = "";

  try {
    if (userId) {
      await ensureCustomerProfile(service, {
        userId,
        companyId,
        customerId,
        fullName,
        email,
        phone: customer.phone,
      });
      accessMethod = "existing";
    } else {
      const existingUser = await findAuthUserByEmail(service, email);
      if (existingUser) {
        userId = existingUser.id;
        await ensureCustomerProfile(service, {
          userId,
          companyId,
          customerId,
          fullName,
          email,
          phone: customer.phone,
        });
        const { error: recoveryError } = await service.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/reset-password?onboarding=customer&quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
        });
        if (recoveryError) throw new Error(`Customer recovery email could not be sent: ${recoveryError.message}`);
        accessMethod = "recovery";
        inviteSent = true;
      } else {
        const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${siteUrl}/auth/complete?quote=${encodeURIComponent(String(quote.quote_number || ""))}`,
          data: { full_name: fullName },
        });
        if (inviteError || !invite.user) throw new Error(inviteError?.message || "Customer invitation could not be created.");
        userId = invite.user.id;
        await ensureCustomerProfile(service, {
          userId,
          companyId,
          customerId,
          fullName,
          email,
          phone: customer.phone,
        });
        accessMethod = "invitation";
        inviteSent = true;
      }
    }
  } catch (error) {
    warning = error instanceof Error ? error.message : "Customer access could not be released automatically.";
    accessMethod = "pending";
    inviteSent = false;
  }

  const invitationStatus = accessMethod === "existing" ? "claimed" : inviteSent ? "sent" : "pending";
  const { error: invitationError } = await service.from("quote_invitations").upsert({
    company_id: companyId,
    quote_id: quoteId,
    email,
    status: invitationStatus,
    sent_at: inviteSent ? new Date().toISOString() : null,
    claimed_by: accessMethod === "existing" ? userId : null,
    claimed_at: accessMethod === "existing" ? new Date().toISOString() : null,
    expires_at: accessMethod === "existing" ? null : new Date(Date.now() + 14 * 86400000).toISOString(),
  }, { onConflict: "quote_id,email" });
  if (invitationError) warning = warning || invitationError.message;

  await service.from("lead_center").update({
    invite_sent_at: inviteSent ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", lead.id);

  return { accessMethod, inviteSent, warning };
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const referralId = String(context.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(referralId)) {
      return NextResponse.json({ error: "Choose a valid referral." }, { status: 400 });
    }

    const body = await request.json() as { accept?: boolean };
    if (typeof body.accept !== "boolean") {
      return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 });
    }

    const { token, service, actorId, companyId } = await requireCompanyUser(request);
    const before = await service.from("lead_center")
      .select("id,status,assigned_company_id,customer_id,quote_id,email,full_name,phone")
      .eq("id", referralId)
      .eq("assigned_company_id", companyId)
      .maybeSingle();
    if (before.error || !before.data) {
      return NextResponse.json({ error: before.error?.message || "Referral not found for this company." }, { status: 404 });
    }

    let referrals: any[] = [];
    if (before.data.status === "offered") {
      const rpc = await userClient(token).rpc("respond_company_referral", {
        p_lead_id: referralId,
        p_accept: body.accept,
      });
      if (rpc.error) throw new Error(rpc.error.message);
      referrals = Array.isArray(rpc.data) ? rpc.data : [];
    } else if (!(body.accept && before.data.status === "converted")) {
      return NextResponse.json({ error: "Referral is unavailable or already answered." }, { status: 409 });
    }

    if (!body.accept) {
      return NextResponse.json({ referrals, accepted: false, inviteSent: false, accessMethod: "none", message: "Referral declined. No Customer Job or Invoice was created." });
    }

    const after = await service.from("lead_center")
      .select("id,status,assigned_company_id,customer_id,quote_id,email,full_name,phone")
      .eq("id", referralId)
      .eq("assigned_company_id", companyId)
      .maybeSingle();
    if (after.error || !after.data || after.data.status !== "converted") {
      throw new Error(after.error?.message || "Company acceptance did not reach the canonical converted state.");
    }

    const access = await releaseCustomerAccess(request, service, after.data, companyId);
    await service.from("activity_log").insert({
      organization_id: companyId,
      company_id: companyId,
      actor_profile_id: actorId,
      action: "referral.customer_access_released",
      entity_type: "lead_center",
      entity_id: referralId,
      details: access.warning
        ? `Company accepted referral. Customer access is pending: ${access.warning}`
        : `Company accepted referral. Customer access method: ${access.accessMethod}.`,
    });

    return NextResponse.json({
      referrals,
      accepted: true,
      inviteSent: access.inviteSent,
      accessMethod: access.accessMethod,
      accessWarning: access.warning || null,
      message: access.warning
        ? `Referral accepted. Customer access still needs attention: ${access.warning}`
        : access.accessMethod === "existing"
          ? "Referral accepted. The Quote is now available in the existing Customer account."
          : `Referral accepted and Customer ${access.accessMethod === "recovery" ? "recovery link" : "invitation"} sent.`,
    });
  } catch (error) {
    console.error("admin-referral-response", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Referral response failed." }, { status: 400 });
  }
}
