import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function failure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function context(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Company onboarding is not configured.");

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in to complete the company profile.");

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your invitation session expired. Sign in again.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,active,full_name,email,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile) throw new Error(profileError?.message || "Company Admin profile was not found.");
  if (!profile.active || !["admin", "manager"].includes(profile.role)) throw new Error("Only an active company Admin can complete this profile.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This Admin is not linked to a company.");
  return { admin, profile, companyId };
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile, companyId } = await context(request);
    const { data: company, error } = await admin
      .from("organizations")
      .select("id,name,slug,contact_email,plan_name,active")
      .eq("id", companyId)
      .single();
    if (error || !company) throw new Error(error?.message || "Company was not found.");
    return NextResponse.json({ company, profile });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Company profile could not be loaded.", 401);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { admin, profile, companyId } = await context(request);
    const body = (await request.json()) as { companyName?: string; adminName?: string; contactEmail?: string };
    const companyName = String(body.companyName || "").trim();
    const adminName = String(body.adminName || "").trim();
    const contactEmail = String(body.contactEmail || "").trim().toLowerCase();
    if (companyName.length < 2) throw new Error("Enter the company name.");
    if (adminName.length < 2) throw new Error("Enter the administrator's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error("Enter a valid company email.");

    const { error: companyError } = await admin
      .from("organizations")
      .update({ name: companyName, contact_email: contactEmail, updated_at: new Date().toISOString() })
      .eq("id", companyId);
    if (companyError) throw new Error(companyError.message);

    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: adminName, email: contactEmail, company_id: companyId, organization_id: companyId, active: true })
      .eq("id", profile.id);
    if (profileError) throw new Error(profileError.message);

    return NextResponse.json({ ok: true, redirectTo: "/admin" });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Company profile could not be saved.");
  }
}
