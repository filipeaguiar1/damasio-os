import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master company creation is not configured on the server.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
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
  if (profileError) throw new Error(`Master profile verification failed: ${profileError.message}`);
  if (!profile?.active || profile.role !== "master") throw new Error("Only an active Master can create a company.");
  return { client, masterId: auth.user.id };
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Company operation failed." }, { status });
}

function inviteFailureMessage(message?: string) {
  return message?.toLowerCase().includes("rate limit")
    ? "Supabase reached its email sending limit. The Admin password was not changed. Retry the invitation/recovery email later."
    : `Admin access email was not sent${message ? `: ${message}` : "."}`;
}

function invitationOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) return configured;
  return request.nextUrl.origin;
}

const companyColumns = "id,name,slug,active,plan_name,contact_email,referral_code,stripe_connect_status,stripe_connected_account_id,created_at,deleted_at,purge_after,deletion_reason";

type CompanyIdentity = { id: string; name: string; contact_email: string };

async function findAuthUserByEmail(client: ReturnType<typeof serverClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Could not check the existing Admin account: ${error.message}`);
    const user = data.users.find((item: any) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

async function ensureAdminProfile(
  client: ReturnType<typeof serverClient>,
  company: CompanyIdentity,
  adminName: string,
  user: any,
) {
  const { data: existing, error: existingError } = await client.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && existing.role !== "admin") {
    throw new Error("This email already belongs to a non-Admin account and cannot be reassigned as company Admin.");
  }
  const existingCompanyId = existing?.company_id || existing?.organization_id;
  if (existingCompanyId && String(existingCompanyId) !== company.id) {
    throw new Error("This Admin login is already linked to another company.");
  }

  const { error: metadataError } = await client.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata || {}), full_name: adminName },
  });
  if (metadataError) throw new Error(metadataError.message);

  const { data: admin, error: profileError } = await client.from("profiles").upsert({
    id: user.id,
    organization_id: company.id,
    company_id: company.id,
    role: "admin",
    full_name: adminName,
    email: company.contact_email,
    active: true,
  }, { onConflict: "id" }).select("id,company_id,full_name,email,active").single();
  if (profileError || !admin) throw new Error(profileError?.message || "The Admin profile could not be linked to this company.");
  return admin;
}

async function linkExistingAdmin(
  client: ReturnType<typeof serverClient>,
  company: CompanyIdentity,
  adminName: string,
  siteUrl: string,
) {
  const user = await findAuthUserByEmail(client, company.contact_email);
  if (!user) throw new Error("This email is registered, but its Auth user could not be located.");
  const admin = await ensureAdminProfile(client, company, adminName, user);
  const { error: resetError } = await client.auth.resetPasswordForEmail(company.contact_email, {
    redirectTo: `${siteUrl}/reset-password?onboarding=company`,
  });
  if (resetError) throw new Error(inviteFailureMessage(resetError.message));
  return { admin, delivery: "recovery" as const };
}

export async function GET(request: NextRequest) {
  try {
    const { client } = await requireMaster(request);
    const [companies, leads, requests, audit, admins, employees, customers] = await Promise.all([
      client.from("organizations").select(companyColumns).order("created_at", { ascending: false }),
      client.from("lead_center").select("*").order("created_at", { ascending: false }),
      client.from("master_company_access_requests").select("*").order("created_at", { ascending: false }),
      client.from("master_audit_log").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("profiles").select("id,company_id,organization_id,full_name,email,active").eq("role", "admin"),
      client.from("employees").select("id,company_id,organization_id,full_name,email,active"),
      client.from("customers").select("id,service_company_id,full_name,email,assignment_status").is("archived_at", null),
    ]);
    if (companies.error) throw new Error(companies.error.message);
    const warnings = [leads.error, requests.error, audit.error, admins.error, employees.error, customers.error]
      .filter(Boolean)
      .map((error: any) => error.message);
    const members = [
      ...(admins.data || []).map((row: any) => ({ id: row.id, company_id: row.company_id || row.organization_id, kind: "admin", name: row.full_name, email: row.email, active: row.active })),
      ...(employees.data || []).map((row: any) => ({ id: row.id, company_id: row.company_id || row.organization_id, kind: "employee", name: row.full_name, email: row.email, active: row.active })),
      ...(customers.data || []).filter((row: any) => Boolean(row.service_company_id)).map((row: any) => ({ id: row.id, company_id: row.service_company_id, kind: "customer", name: row.full_name, email: row.email, active: row.assignment_status !== "paused" })),
    ];
    return NextResponse.json({ companies: companies.data || [], leads: leads.data || [], requests: requests.data || [], audit: audit.data || [], members, warnings });
  } catch (error) {
    return failure(error, 401);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { id?: string; active?: boolean; action?: "restore" };
    if (!body.id) throw new Error("Company is required.");
    if (body.action === "restore") {
      const { data, error } = await client.rpc("master_restore_company", { p_company_id: body.id, p_master_profile_id: masterId });
      if (error || !data) throw new Error(error?.message || "Company could not be restored.");
      return NextResponse.json({ company: data, message: "Company restored. Files, accounts and tools were queued for synchronization." });
    }
    if (typeof body.active !== "boolean") throw new Error("Company status is required.");
    const { data, error } = await client.from("organizations")
      .update({ active: body.active, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .is("deleted_at", null)
      .select(companyColumns)
      .single();
    if (error || !data) throw new Error(error?.message || "Company could not be updated.");
    await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: data.id,
      action: body.active ? "company.activated" : "company.deactivated",
      entity_type: "organization",
      entity_id: data.id,
    });
    return NextResponse.json({ company: data });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { id?: string; reason?: string };
    if (!body.id) throw new Error("Choose a company.");
    const { data, error } = await client.rpc("master_trash_company", {
      p_company_id: body.id,
      p_master_profile_id: masterId,
      p_reason: body.reason || null,
    });
    if (error || !data) throw new Error(error?.message || "Company could not be moved to trash.");
    return NextResponse.json({ company: data, message: "Company moved to Trash for 60 days. Files, accounts and tools were queued for synchronization." });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  let invitedUserId = "";
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { id?: string; adminName?: string };
    if (!body.id) throw new Error("Choose a company.");

    const { data: company, error: companyError } = await client.from("organizations")
      .select("id,name,contact_email")
      .eq("id", body.id)
      .single();
    if (companyError || !company) throw new Error(companyError?.message || "Company not found.");
    if (!company.contact_email) throw new Error("Add a contact email before sending Admin access.");

    const existingProfile = await client.from("profiles").select("id,full_name").eq("email", company.contact_email).maybeSingle();
    const adminName = String(body.adminName || existingProfile.data?.full_name || `${company.name} Admin`).trim();
    const siteUrl = invitationOrigin(request);
    let admin: any;
    let delivery: "invitation" | "recovery" = "invitation";

    if (existingProfile.data) {
      const linked = await linkExistingAdmin(client, company, adminName, siteUrl);
      admin = linked.admin;
      delivery = linked.delivery;
    } else {
      const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(company.contact_email, {
        redirectTo: `${siteUrl}/auth/complete`,
        data: { full_name: adminName },
      });
      if (inviteError || !invite.user) {
        if (inviteError?.message?.toLowerCase().includes("already") || inviteError?.message?.toLowerCase().includes("registered")) {
          const linked = await linkExistingAdmin(client, company, adminName, siteUrl);
          admin = linked.admin;
          delivery = linked.delivery;
        } else {
          return NextResponse.json({ error: inviteFailureMessage(inviteError?.message) }, { status: inviteError?.message?.toLowerCase().includes("rate limit") ? 429 : 400 });
        }
      } else {
        invitedUserId = invite.user.id;
        admin = await ensureAdminProfile(client, company, adminName, invite.user);
      }
    }

    const { error: auditError } = await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: company.id,
      action: delivery === "invitation" ? "company.admin_invited" : "company.admin_recovery_sent",
      entity_type: "profile",
      entity_id: admin.id,
      details: { admin_email: company.contact_email, delivery },
    });
    if (auditError) throw new Error(auditError.message);

    const message = delivery === "recovery"
      ? `Recovery email sent to ${company.contact_email}. The Admin's existing password was not changed by Master.`
      : `Admin invitation sent to ${company.contact_email}.`;
    return NextResponse.json({
      member: { id: admin.id, company_id: company.id, kind: "admin", name: admin.full_name, email: admin.email, active: admin.active },
      message,
      delivery,
      temporaryPassword: null,
    });
  } catch (error) {
    if (invitedUserId) {
      try { await serverClient().auth.admin.deleteUser(invitedUserId); } catch {}
    }
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  let companyId = "";
  let adminUserId = "";
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { name?: string; slug?: string; plan?: string; adminName?: string; adminEmail?: string };
    const name = String(body.name || "").trim();
    const adminName = String(body.adminName || "").trim();
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
    const plan = ["standard", "professional", "enterprise"].includes(String(body.plan)) ? String(body.plan) : "standard";
    if (name.length < 2) throw new Error("Enter the company name.");
    if (adminName.length < 2) throw new Error("Enter the first Admin's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error("Enter a valid Admin email.");

    const baseSlug = slugify(String(body.slug || name)) || "company";
    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const { data: company, error: companyError } = await client.from("organizations").insert({
      name,
      slug,
      plan_name: plan,
      contact_email: adminEmail,
      active: true,
    }).select("id,name,slug,active,plan_name,contact_email,created_at").single();
    if (companyError || !company) throw new Error(companyError?.message || "Company could not be created.");
    companyId = company.id;

    const qaNoEmail = request.headers.get("x-damasio-qa-no-email") === "1" && /^(localhost|127\.0\.0\.1)$/.test(request.nextUrl.hostname);
    if (qaNoEmail) {
      const existingUser = await findAuthUserByEmail(client, adminEmail);
      if (!existingUser) throw new Error("QA no-email mode requires a pre-created confirmed Admin Auth identity.");
      const qaAdmin = await ensureAdminProfile(client, { id: companyId, name: company.name, contact_email: adminEmail }, adminName, existingUser);
      await client.from("master_audit_log").insert({
        master_profile_id: masterId,
        company_id: companyId,
        action: "company.created_qa_no_email",
        entity_type: "organization",
        entity_id: companyId,
        details: { admin_email: adminEmail, plan, delivery: "none" },
      });
      return NextResponse.json({
        company,
        inviteSent: false,
        qaNoEmail: true,
        temporaryPassword: null,
        member: { id: qaAdmin.id, company_id: companyId, kind: "admin", name: qaAdmin.full_name, email: qaAdmin.email, active: qaAdmin.active },
        message: "Company created in localhost QA no-email mode.",
      });
    }

    const siteUrl = invitationOrigin(request);
    const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(adminEmail, {
      redirectTo: `${siteUrl}/auth/complete`,
      data: { full_name: adminName },
    });

    if (inviteError || !invite.user) {
      if (inviteError?.message?.toLowerCase().includes("already") || inviteError?.message?.toLowerCase().includes("registered")) {
        const linked = await linkExistingAdmin(client, { id: company.id, name: company.name, contact_email: adminEmail }, adminName, siteUrl);
        await client.from("master_audit_log").insert({
          master_profile_id: masterId,
          company_id: companyId,
          action: "company.created_existing_admin_relinked",
          entity_type: "profile",
          entity_id: linked.admin.id,
          details: { admin_email: adminEmail, plan, delivery: linked.delivery },
        });
        return NextResponse.json({
          company,
          inviteSent: true,
          temporaryPassword: null,
          delivery: linked.delivery,
          message: `Company created and recovery email sent to ${adminEmail}. The existing password was not changed by Master.`,
        });
      }
      throw new Error(inviteFailureMessage(inviteError?.message));
    }

    adminUserId = invite.user.id;
    const admin = await ensureAdminProfile(client, { id: companyId, name: company.name, contact_email: adminEmail }, adminName, invite.user);
    const { error: auditError } = await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: companyId,
      action: "company.created",
      entity_type: "organization",
      entity_id: companyId,
      details: { admin_email: adminEmail, plan, delivery: "invitation" },
    });
    if (auditError) throw new Error(auditError.message);

    return NextResponse.json({
      company,
      inviteSent: true,
      temporaryPassword: null,
      member: { id: admin.id, company_id: companyId, kind: "admin", name: admin.full_name, email: admin.email, active: admin.active },
      message: `Company created and Admin invitation sent to ${adminEmail}.`,
    });
  } catch (error) {
    const client = serverClient();
    if (adminUserId) {
      try { await client.auth.admin.deleteUser(adminUserId); } catch {}
    }
    if (companyId) {
      try { await client.from("organizations").delete().eq("id", companyId); } catch {}
    }
    return failure(error);
  }
}
