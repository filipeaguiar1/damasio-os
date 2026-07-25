import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer registration access is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Registration access could not be sent." }, { status });
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Only Master can send platform registration access.");
  return { client, masterId: auth.user.id };
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

function temporaryPassword() {
  return `Damasio-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}!7a`;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const leadId = context.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(leadId)) throw new Error("Choose a valid lead.");
    const { client, masterId } = await requireMaster(request);
    const { data: lead, error: leadError } = await client.from("lead_center").select("id,full_name,email,phone,status").eq("id", leadId).maybeSingle();
    if (leadError || !lead) throw new Error(leadError?.message || "Lead not found.");

    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) throw new Error("This lead needs an email before registration access can be sent.");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
    const redirectTo = `${siteUrl}/auth/complete?source=platform&lead=${encodeURIComponent(leadId)}`;
    let user = await findAuthUserByEmail(client, email);
    let delivery: "invitation" | "recovery" | "temporary_password" = "invitation";
    let generatedPassword = "";

    if (!user) {
      const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          full_name: lead.full_name || "Customer",
          role: "customer",
          acquisition_source: "platform",
          assignment_status: "pending_payment",
          lead_id: leadId,
        },
      });
      if (inviteError || !invite.user) throw new Error(inviteError?.message || "Customer invitation could not be sent.");
      user = invite.user;
      delivery = "invitation";
    } else {
      const { error: metadataError } = await client.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...(user.user_metadata || {}),
          full_name: lead.full_name || user.user_metadata?.full_name || "Customer",
          role: "customer",
          acquisition_source: user.user_metadata?.acquisition_source || "platform",
          assignment_status: "pending_payment",
          lead_id: leadId,
        },
      });
      if (metadataError) throw new Error(metadataError.message);

      const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (!recoveryError) {
        delivery = "recovery";
      } else if (String(recoveryError.message || "").toLowerCase().includes("rate limit")) {
        generatedPassword = temporaryPassword();
        const { error: passwordError } = await client.auth.admin.updateUserById(user.id, {
          password: generatedPassword,
          email_confirm: true,
        });
        if (passwordError) throw new Error(passwordError.message);
        delivery = "temporary_password";
      } else {
        throw new Error(recoveryError.message);
      }
    }

    const { error: profileError } = await client.from("profiles").upsert({
      id: user.id,
      organization_id: null,
      company_id: null,
      role: "customer",
      full_name: lead.full_name || "Customer",
      email,
      phone: lead.phone || null,
      active: true,
    }, { onConflict: "id" });
    if (profileError) throw new Error(profileError.message);

    await client.from("lead_center").update({
      assigned_company_id: null,
      status: "registration_sent",
      invite_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);

    await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: null,
      action: "lead.platform_registration_sent",
      entity_type: "lead_center",
      entity_id: leadId,
      details: { email, delivery, remains_unassigned: true },
    });

    const message = delivery === "invitation"
      ? `Platform registration invitation sent to ${email}. The customer remains unassigned.`
      : delivery === "recovery"
        ? `Registration access sent to the existing account at ${email}. The customer remains unassigned.`
        : `Email delivery is temporarily limited. Temporary password: ${generatedPassword}. The customer remains unassigned.`;

    return NextResponse.json({ delivery, temporaryPassword: generatedPassword || undefined, message });
  } catch (error) {
    return fail(error);
  }
}
