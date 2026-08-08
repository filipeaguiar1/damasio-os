import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminEmail = process.env.E2E_ADMIN_EMAIL || "";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "";

async function adminSession() {
  const client = createClient(supabaseURL, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  expect(login.error, login.error?.message).toBeNull();
  const token = login.data.session?.access_token || "";
  const userId = login.data.user?.id || "";
  expect(token).toBeTruthy();
  expect(userId).toBeTruthy();
  return { token, userId };
}

async function signIn(page: any, email: string, password: string) {
  await page.goto(`${baseURL}/mobile/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.waitForURL(url => url.pathname.startsWith("/mobile/employee"), { timeout: 30_000 });
}

test("employee mobile polish keeps login, menu, Customers and Profile usable", async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  expect(supabaseURL, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();
  expect(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();
  expect(adminEmail, "E2E_ADMIN_EMAIL is required").toBeTruthy();
  expect(adminPassword, "E2E_ADMIN_PASSWORD is required").toBeTruthy();

  const admin = await adminSession();
  const service = createClient(supabaseURL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const adminProfile = await service.from("profiles")
    .select("company_id,organization_id")
    .eq("id", admin.userId)
    .single();
  expect(adminProfile.error, adminProfile.error?.message).toBeNull();
  const companyId = String(adminProfile.data?.company_id || adminProfile.data?.organization_id || "");
  expect(companyId).toBeTruthy();

  const stamp = Date.now().toString(36);
  const workerEmail = `mobile-polish-${stamp}@4everseasons.test`;
  const workerPassword = `MobilePolish!${stamp}A9`;
  let workerId = "";
  let crewId = "";
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  const cleanup = async () => {
    if (workerId) {
      await service.from("employees").delete().eq("profile_id", workerId);
      if (crewId) await service.from("crews").delete().eq("id", crewId);
      await service.from("profiles").delete().eq("id", workerId);
      const removed = await service.auth.admin.deleteUser(workerId);
      if (removed.error && !String(removed.error.message || "").toLowerCase().includes("not found")) {
        console.warn(`Mobile polish auth cleanup: ${removed.error.message}`);
      }
    }
  };

  try {
    const authUser = await service.auth.admin.createUser({
      email: workerEmail,
      password: workerPassword,
      email_confirm: true,
      user_metadata: { full_name: "Mobile Polish Worker", role: "employee", company_id: companyId },
    });
    expect(authUser.error, authUser.error?.message).toBeNull();
    workerId = String(authUser.data?.user?.id || "");
    expect(workerId).toBeTruthy();

    const profile = await service.from("profiles").upsert({
      id: workerId,
      organization_id: companyId,
      company_id: companyId,
      role: "employee",
      full_name: "Mobile Polish Worker",
      email: workerEmail,
      active: true,
      invite_status: "accepted",
    }, { onConflict: "id" });
    expect(profile.error, profile.error?.message).toBeNull();

    const crew = await service.from("crews").insert({
      organization_id: companyId,
      company_id: companyId,
      name: `Mobile Polish ${stamp}`,
      active: true,
    }).select("id").single();
    expect(crew.error, crew.error?.message).toBeNull();
    crewId = String(crew.data?.id || "");
    expect(crewId).toBeTruthy();

    const employee = await service.from("employees").insert({
      organization_id: companyId,
      company_id: companyId,
      profile_id: workerId,
      crew_id: crewId,
      full_name: "Mobile Polish Worker",
      email: workerEmail,
      province: "ON",
      active: true,
      invite_status: "accepted",
    });
    expect(employee.error, employee.error?.message).toBeNull();

    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Toronto",
    });
    const page = await context.newPage();

    await page.goto(`${baseURL}/mobile/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const hero = page.locator(".mobile-login-page .mobile-hero-card");
    const loginCard = page.locator(".mobile-login-page .mobile-login-card");
    await expect(hero).toBeVisible();
    await expect(loginCard).toBeVisible();
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".mobile-login-page")?.getBoundingClientRect();
      const heroRect = document.querySelector(".mobile-login-page .mobile-hero-card")?.getBoundingClientRect();
      const cardRect = document.querySelector(".mobile-login-page .mobile-login-card")?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        shellHeight: shell?.height || 0,
        top: heroRect?.top || 0,
        bottom: cardRect ? cardRect.bottom : 0,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(layout.shellHeight).toBeGreaterThanOrEqual(layout.viewportHeight - 2);
    expect(layout.top, "Login content should not be pinned against the top edge").toBeGreaterThan(18);
    expect(layout.viewportHeight - layout.bottom, "Login content should remain visible above the bottom edge").toBeGreaterThan(18);
    expect(layout.scrollHeight - layout.viewportHeight, "Login should not need vertical scrolling on the standard mobile viewport").toBeLessThanOrEqual(4);
    await page.screenshot({ path: "employee-polish-login.png", fullPage: true });

    await signIn(page, workerEmail, workerPassword);
    const menuButton = page.locator(".employee-polish-menu-button");
    await expect(menuButton).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".employee-mobile-brand small")).toHaveText("Mobile Polish Worker", { timeout: 30_000 });
    await expect(page.locator(".employee-mobile-brand>span")).toBeHidden();
    const menuPosition = await menuButton.evaluate(element => getComputedStyle(element).position);
    expect(menuPosition, "Employee menu should not float with viewport scrolling").toBe("absolute");

    await menuButton.click();
    const drawer = page.locator(".employee-polish-menu-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(drawer.locator('a[href="/mobile/employee/home"]')).toHaveCount(0);
    await expect(drawer.getByRole("link", { name: /Routes/i })).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByRole("link", { name: /Customers/i })).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByRole("link", { name: /Profile/i })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: "employee-polish-menu.png", fullPage: true });

    await drawer.getByRole("link", { name: /Customers/i }).click();
    await page.waitForURL("**/mobile/employee/customers", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Your assigned customers" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".employee-polish-menu-button")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "employee-polish-customers.png", fullPage: true });

    await page.locator(".employee-polish-menu-button").click();
    const profileLink = page.locator(".employee-polish-menu-drawer").getByRole("link", { name: /Profile/i });
    await expect(profileLink).toBeVisible({ timeout: 30_000 });
    await profileLink.click();
    await page.waitForURL("**/mobile/employee/profile", { timeout: 30_000 });
    await expect(page.getByText("My profile", { exact: true })).toBeVisible({ timeout: 30_000 });
    const saveProfile = page.getByRole("button", { name: "Save profile" });
    await expect(saveProfile).toBeVisible({ timeout: 30_000 });
    await expect(saveProfile).toBeEnabled({ timeout: 30_000 });
    await saveProfile.click();
    await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "employee-polish-profile.png", fullPage: true });

    await page.goto(`${baseURL}/mobile/employee`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.locator(".employee-profile-trigger")).toBeVisible({ timeout: 30_000 });
    await page.locator(".employee-profile-trigger").click();
    await page.waitForURL("**/mobile/employee/profile", { timeout: 30_000 });
    await expect(page.getByText("My profile", { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    if (context) await context.close().catch(() => undefined);
    await cleanup();
  }
});
