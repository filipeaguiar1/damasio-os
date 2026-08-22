import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { signInBrowser } from "./browser-operator/fixture-env";

const baseURL = "http://127.0.0.1:3000";
const torontoContext = { timezoneId: "America/Toronto" } as const;

test.setTimeout(360_000);

function watchErrors(page: Page, label: string) {
  const errors: string[] = [];
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/TypeError: Failed to fetch[\s\S]*_useSession/.test(text)) {
      console.warn(`${label}: authentication fetch was aborted by a page transition.`);
      return;
    }
    if (/Failed to fetch RSC payload[\s\S]*Falling back to browser navigation[\s\S]*TypeError: Failed to fetch/i.test(text)) {
      console.warn(`${label}: Next.js RSC prefetch failed and browser navigation fallback was used.`);
      return;
    }
    if (/Failed to load resource: the server responded with a status of \d{3}/i.test(text)) return;
    errors.push(`${label}: ${text}`);
  });
  page.on("response", response => {
    const url = response.url();
    if (!url.startsWith(baseURL) || /\/favicon\.ico(?:\?|$)/.test(url)) return;
    if (response.status() < 400) {
      for (let index = errors.length - 1; index >= 0; index -= 1) {
        if (/HTTP (401|502|503|504) /.test(errors[index]) && errors[index].endsWith(` ${url}`)) errors.splice(index, 1);
      }
      return;
    }
    errors.push(`${label}: HTTP ${response.status()} ${url}`);
  });
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  return errors;
}

async function assertHealthy(page: Page, label: string, mobile = false) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(750);
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Page crashed|404: This page could not be found|Page not found/i);
  await expect(page.locator("[data-nextjs-dialog], .nextjs-container-errors-header")).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    bodyText: document.body.innerText.trim().length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(layout.bodyText, `${label} rendered no meaningful content`).toBeGreaterThan(30);
  expect(layout.overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(mobile ? 4 : 8);
}

async function signIn(page: Page, email: string, password: string) {
  await signInBrowser(page, email, password);
}

test("production-like Admin, Employee and Customer recovery flow", async ({ browser }) => {
  const adminContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const adminErrors = watchErrors(admin, "Admin");
  await signIn(admin, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await admin.waitForURL("**/admin", { timeout: 30_000 });
  adminErrors.splice(0); // Ignore requests started by the unauthenticated login page.
  await admin.goto(`${baseURL}/admin/performance/simulator`);
  await expect(admin.getByRole("heading", { name: "Financial & Operational Simulator" })).toBeVisible();

  const create = admin.getByRole("button", { name: "Create 2-Month Simulation" });
  const remove = admin.getByRole("button", { name: "Remove Simulation" });
  await expect.poll(async () => {
    const createReady = await create.isEnabled().catch(() => false);
    const removeReady = await remove.isEnabled().catch(() => false);
    return createReady || removeReady;
  }, { timeout: 30_000 }).toBe(true);

  if (await remove.isEnabled()) {
    admin.once("dialog", dialog => dialog.accept());
    await remove.click();
    await expect(admin.locator(".payment-message")).toContainText(/simulation customers.*removed/i, { timeout: 60_000 });
    await expect(create).toBeEnabled({ timeout: 30_000 });
  }

  await create.click();
  const simulationMessage = admin.locator(".payment-message");
  await expect(simulationMessage).toBeVisible({ timeout: 180_000 });
  expect(await simulationMessage.innerText()).toMatch(/completed eight weeks of canonical lawn service/i);
  await expect(admin.getByText("480 completed visits", { exact: false })).toBeVisible();
  await expect(admin.getByText(/120 paid invoices/i)).toBeVisible();

  const codes = admin.locator("code");
  const workerEmail = (await codes.nth(0).innerText()).trim();
  const workerPassword = (await codes.nth(1).innerText()).trim();
  const customerEmail = (await codes.nth(4).innerText()).trim();
  const customerPassword = (await codes.nth(5).innerText()).trim();
  expect(workerEmail).toContain("worker-1@4everseasons.test");
  expect(customerEmail).toContain("customer-01@4everseasons.test");
  writeFileSync("/tmp/damasio-operational-simulator-handoff.json", JSON.stringify({
    workerEmail, workerPassword,
  }), "utf8");

  await admin.getByRole("button", { name: "Run Exception Week" }).click();
  await expect(simulationMessage).toContainText(/Exception week seeded/i, { timeout: 60_000 });
  const liveExceptions = admin.getByRole("heading", { name: "Live Exception Status" }).locator("xpath=ancestor::section");
  await expect(liveExceptions.getByText("Rain-rescheduled visits").locator("..").getByText("8", { exact: true })).toBeVisible();
  await expect(liveExceptions.getByText("Late arrivals").locator("..").getByText("1", { exact: true })).toBeVisible();

  for (const path of [
    "/admin",
    "/admin/customers",
    "/admin/properties",
    "/admin/estimates",
    "/admin/operations",
    "/admin/routes?tab=view",
    "/admin/finance",
    "/admin/invoices",
    "/admin/tasks",
    "/admin/performance/simulator",
  ]) {
    await admin.goto(`${baseURL}${path}`);
    await assertHealthy(admin, `Admin ${path}`);
    console.log(`QA_ADMIN_PATH: ${path}`);
  }

  const employeeContext = await browser.newContext({ ...torontoContext, viewport: { width: 390, height: 844 } });
  const employee = await employeeContext.newPage();
  const employeeErrors = watchErrors(employee, "Employee");
  await signIn(employee, workerEmail, workerPassword);
  employeeErrors.splice(0);
  await employee.goto(`${baseURL}/mobile/employee`);
  await assertHealthy(employee, "Employee mobile route", true);
  await employee.screenshot({ path: "employee-live-route.png", fullPage: true });

  const customerContext = await browser.newContext({ ...torontoContext, viewport: { width: 390, height: 844 } });
  const customer = await customerContext.newPage();
  const customerErrors = watchErrors(customer, "Customer");
  await signIn(customer, customerEmail, customerPassword);
  customerErrors.splice(0);

  for (const path of [
    "/mobile/customer",
    "/mobile/customer/payments",
    "/mobile/customer/requests",
    "/customer/feedback",
  ]) {
    await customer.goto(`${baseURL}${path}`);
    await assertHealthy(customer, `Customer mobile ${path}`, true);
    console.log(`QA_CUSTOMER_MOBILE_PATH: ${path}`);
  }

  const customerDesktopContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const customerDesktop = await customerDesktopContext.newPage();
  const customerDesktopErrors = watchErrors(customerDesktop, "Customer desktop");
  await signIn(customerDesktop, customerEmail, customerPassword);
  customerDesktopErrors.splice(0);
  for (const path of ["/customer", "/customer/payments", "/customer/invoices", "/customer/feedback"]) {
    await customerDesktop.goto(`${baseURL}${path}`);
    await assertHealthy(customerDesktop, `Customer desktop ${path}`);
    console.log(`QA_CUSTOMER_DESKTOP_PATH: ${path}`);
  }
  await customerDesktop.screenshot({ path: "customer-desktop-qa.png", fullPage: true });

  expect(adminErrors, adminErrors.join("\n")).toEqual([]);
  expect(employeeErrors, employeeErrors.join("\n")).toEqual([]);
  expect(customerErrors, customerErrors.join("\n")).toEqual([]);
  expect(customerDesktopErrors, customerDesktopErrors.join("\n")).toEqual([]);

  await adminContext.close();
  await employeeContext.close();
  await customerContext.close();
  await customerDesktopContext.close();
});
