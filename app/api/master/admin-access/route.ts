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
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireMaster(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonKey || !token) throw new Error("Sign in as Master.");

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired.");
  const { data: profile, error: profileError } = await authClient
    .from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can generate temporary passwords.");
  return { client: adminClient(), masterId: auth.user.id };
}

async function findUserByEmail(client: ReturnType<typeof adminClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = data.users.find((item) => item.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

function temporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const token = Array.from(bytes, (value) => value.toString(36)).join("").slice(0, 14);
  return `Ds!${token}9`;
}

export async function POST(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = (await request.json()) as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid company Admin email is required.");

    const { data: company, error: companyError } = await client
      .from("organizations")
      .select("id,name,contact_email")
      .eq("contact_email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (companyError || !company) throw new Error(companyError?.message || "No active company uses this Admin email.");

    const user = await findUserByEmail(client, email);
    if (!user) throw new Error("This Admin does not exist in Supabase Authentication.");

    const password = temporaryPassword();
    const { error: updateError } = await client.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata || {}),
        role: "admin",
        company_id: company.id,
      },
    });
    if (updateError) throw new Error(updateError.message);

    const { error: profileError } = await client.from("profiles").upsert({
      id: user.id,
      role: "admin",
      email,
      active: true,
      company_id: company.id,
      organization_id: company.id,
      full_name: String(user.user_metadata?.full_name || company.name + " Admin"),
    }, { onConflict: "id" });
    if (profileError) throw new Error(profileError.message);

    await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: company.id,
      action: "company.admin_temporary_password_generated",
      entity_type: "profile",
      entity_id: user.id,
      details: { admin_email: email },
    });

    return NextResponse.json({
      ok: true,
      email,
      temporaryPassword: password,
      message: "Temporary password generated. The Admin can sign in now and complete the company profile.",
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Temporary password could not be generated.", 401);
  }
}
