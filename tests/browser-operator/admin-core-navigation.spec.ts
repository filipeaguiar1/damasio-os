import { expect, test } from "@playwright/test";
import { assertBrowserOperatorSafety } from "./safety";

const adminEmail = process.env.QA_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || "";
const adminPassword = process.env.QA_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD || "";

async function signInAdmin(page: any) {
  expect(adminEmail, "QA_ADMIN_EMAIL/E2E_ADMIN_EMAIL is required").toBeTruthy();
  expect(adminPassword, "QA_ADMIN_PASSWORD/E2E_ADMIN_PASSWORD is required").toBeTruthy();

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
  expect(page.url()).not.toMatch(/\/login(?:\?|$)/);
}

const coreScreens = [
  { name: "admin-home", path: "/admin" },
  { name: "customers", path: "/admin/customers" },
  { name: "calendar", path: "/admin/calendar" },
  { name: "routes", path: "/admin/routes" },
  { name: "employees", path: "/admin/employees" },
  { name: "estimates", path: "/admin/estimates" },
  { name: "finance", path: "/admin/finance" },
] as const;

test("real admin operator can traverse core company screens without dead loading states", async ({ page }, testInfo) => {
  assertBrowserOperatorSafety();
  await signInAdmin(page);

  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => consoleErrors.push(error.message));

  for (const screen of coreScreens) {
    await test.step(screen.name, async () => {
      const response = await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      expect(response?.status(), `${screen.path} returned a server error`).toBeLessThan(500);
      await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
      expect(new URL(page.url()).pathname).toBe(screen.path);
      await testInfo.attach(`operator-${screen.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }

  const serious = consoleErrors.filter(message => !/favicon|hydration/i.test(message));
  expect(serious, `Browser console/page errors:\n${serious.join("\n")}`).toEqual([]);
});

test("routes and calendar remain recoverable after reloads like a returning operator", async ({ page }, testInfo) => {
  assertBrowserOperatorSafety();
  await signInAdmin(page);

  for (const path of ["/admin/routes", "/admin/calendar"]) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
    expect(new URL(page.url()).pathname).toBe(path);
  }

  await testInfo.attach("operator-routes-calendar-reload", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
