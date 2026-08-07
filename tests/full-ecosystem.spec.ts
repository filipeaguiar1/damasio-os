import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function required(name: string, value?: string) {
  if (!value) throw new Error(`Missing required E2E secret: ${name}`);
  return value;
}

test("Master creates an isolated company and first Admin can authenticate", async ({ request }) => {
  required("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  required("SUPABASE_SERVICE_ROLE_KEY", serviceKey);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Use a syntactically valid public domain. Supabase Auth rejects reserved .test addresses.
  const masterEmail = `qa-master-${stamp}@example.com`;
  const masterPassword = `QaMaster!${stamp}Aa1`;
  const adminEmail = `qa-admin-${stamp}@example.com`;
  const companyName = `QA Ecosystem ${stamp}`;
  const slug = `qa-ecosystem-${stamp}`.toLowerCase();

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let masterUserId = "";
  let adminUserId = "";
  let companyId = "";

  try {
    const createdMaster = await service.auth.admin.createUser({
      email: masterEmail,
      password: masterPassword,
      email_confirm: true,
      user_metadata: { full_name: "QA Master" },
    });
    expect(createdMaster.error, createdMaster.error?.message).toBeNull();
    masterUserId = createdMaster.data.user?.id || "";
    expect(masterUserId).not.toBe("");

    const profileWrite = await service.from("profiles").upsert({
      id: masterUserId,
      role: "master",
      full_name: "QA Master",
      email: masterEmail,
      active: true,
    });
    expect(profileWrite.error, profileWrite.error?.message).toBeNull();

    const signedIn = await anon.auth.signInWithPassword({ email: masterEmail, password: masterPassword });
    expect(signedIn.error, signedIn.error?.message).toBeNull();
    const token = signedIn.data.session?.access_token;
    expect(token).toBeTruthy();

    const response = await request.post(`${appUrl}/api/master/companies`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        name: companyName,
        slug,
        plan: "professional",
        adminName: "QA Company Admin",
        adminEmail,
      },
    });
    const text = await response.text();
    expect(response.ok(), `Master company creation failed: HTTP ${response.status()} ${text}`).toBeTruthy();
    const result = JSON.parse(text);
    companyId = result.company?.id || result.id || "";
    expect(companyId, `Company id missing from response: ${text}`).not.toBe("");

    const companyRead = await service.from("organizations").select("id,name,slug").eq("id", companyId).maybeSingle();
    expect(companyRead.error, companyRead.error?.message).toBeNull();
    expect(companyRead.data?.name).toBe(companyName);

    const adminProfile = await service.from("profiles").select("id,email,role,organization_id").eq("email", adminEmail).maybeSingle();
    expect(adminProfile.error, adminProfile.error?.message).toBeNull();
    expect(adminProfile.data?.role).toBe("admin");
    expect(adminProfile.data?.organization_id).toBe(companyId);
    adminUserId = adminProfile.data?.id || "";
    expect(adminUserId).not.toBe("");

    console.log(JSON.stringify({ checkpoint: "master-company-admin", companyId, companyName, adminEmail }));
  } finally {
    if (adminUserId) await service.auth.admin.deleteUser(adminUserId).catch(() => undefined);
    if (companyId) await service.from("organizations").delete().eq("id", companyId);
    if (masterUserId) {
      await service.from("profiles").delete().eq("id", masterUserId);
      await service.auth.admin.deleteUser(masterUserId).catch(() => undefined);
    }
  }
});
