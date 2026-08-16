import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase Admin access is not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = adminClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired.");
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") {
    throw new Error("Only an active Master can send Admin recovery access.");
  }
  return { client, masterId: auth.user.id };
}

async function findUserByEmail(client: ReturnType<typeof adminClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = data.users.find((item: any) => item.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

function recoveryOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) return configured;
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = (await request.json()) as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid company Admin email is required.");

    const { data: company, error: companyError } = await client.from("organizations")
      .select("id,name,contact_email,active")
      .eq("contact_email", email)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (companyError || !company) throw new Error(companyError?.message || "No active company uses this Admin email.");

    const user = await findUserByEmail(client, email);
    if (!user) throw new Error("This Admin does not exist in Supabase Authentication.");

    const { data: profile, error: profileError } = await client.from("profiles")
      .select("id,role,active,company_id,organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    const profileCompanyId = profile?.company_id || profile?.organization_id;
    if (!profile?.active || profile.role !== "admin" || String(profileCompanyId || "") !== String(company.id)) {
      throw new Error("This login is not the active Admin account for the selected company.");
    }

    const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${recoveryOrigin(request)}/reset-password?onboarding=company`,
    });
    if (recoveryError) throw new Error(`Admin recovery email could not be sent: ${recoveryError.message}`);

    const { error: auditError } = await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: company.id,
      action: "company.admin_recovery_sent",
      entity_type: "profile",
      entity_id: user.id,
      details: { admin_email: email },
    });
    if (auditError) throw new Error(auditError.message);

    return NextResponse.json({
      ok: true,
      email,
      delivery: "recovery",
      message: "Recovery link sent to the company Admin. The existing password was not changed by Master.",
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Admin recovery could not be sent.", 401);
  }
}
