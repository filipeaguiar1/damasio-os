import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const handoffPath = "/tmp/damasio-operational-simulator-handoff.json";

async function signIn(page: any, email: string, password: string) {
  await page.goto(`${baseURL}/mobile/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.waitForURL(url => url.pathname.startsWith("/mobile/employee"), { timeout: 30_000 });
}

test("employee mobile polish keeps login, menu, Customers and Profile usable", async ({ browser }) => {
  test.setTimeout(180_000);
  expect(existsSync(handoffPath), "Operational Simulator handoff fixture must exist").toBe(true);
  const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  const workerEmail = String(handoff.workerEmail || "");
  const workerPassword = String(handoff.workerPassword || "");
  expect(workerEmail).toBeTruthy();
  expect(workerPassword).toBeTruthy();

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/Toronto",
  });
  const page = await context.newPage();

  await page.goto(`${baseURL}/mobile/login`);
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
  await expect(page.locator(".employee-polish-menu-button")).toBeVisible({ timeout: 30_000 });
  await page.locator(".employee-polish-menu-button").click();
  const drawer = page.locator(".employee-polish-menu-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: /Customers/i })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /Profile/i })).toBeVisible();
  await page.screenshot({ path: "employee-polish-menu.png", fullPage: true });

  await drawer.getByRole("link", { name: /Customers/i }).click();
  await page.waitForURL("**/mobile/employee/customers");
  await expect(page.getByRole("heading", { name: "Your assigned customers" })).toBeVisible();
  await expect(page.locator(".employee-polish-menu-button")).toBeVisible();
  await page.screenshot({ path: "employee-polish-customers.png", fullPage: true });

  await page.locator(".employee-polish-menu-button").click();
  await page.locator(".employee-polish-menu-drawer").getByRole("link", { name: /Profile/i }).click();
  await page.waitForURL("**/mobile/employee/profile");
  await expect(page.getByText("My profile", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page.screenshot({ path: "employee-polish-profile.png", fullPage: true });

  await page.locator(".employee-polish-menu-button").click();
  await page.locator(".employee-polish-menu-drawer").getByRole("link", { name: /^Home/i }).click();
  await page.waitForURL("**/mobile/employee/home");
  await expect(page.locator(".employee-polish-menu-button")).toHaveCount(0);

  await page.goto(`${baseURL}/mobile/employee`);
  await expect(page.locator(".employee-profile-trigger")).toBeVisible({ timeout: 30_000 });
  await page.locator(".employee-profile-trigger").click();
  await page.waitForURL("**/mobile/employee/profile");
  await expect(page.getByText("My profile", { exact: true })).toBeVisible();

  await context.close();
});
