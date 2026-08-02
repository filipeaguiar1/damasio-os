import { test, expect, type Page } from "@playwright/test";

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
    if (/Failed to load resource: the server responded with a status of \d{3}/i.test(text)) return;
    errors.push(`${label}: ${text}`);
  });
  page.on("response", response => {
    if (response.status() < 400) return;
    const url = response.url();
    if (!url.startsWith(baseURL) || /\/favicon\.ico(?:\?|$)/.test(url)) return;
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
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("production-like Admin, Employee and Customer recovery flow", async ({ browser }) => {
  const adminContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const adminErrors = watchErrors(admin, "Admin");
  await signIn(admin, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await admin.waitForURL("**/admin", { timeout: 30_000 });
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
    console.log(`QA_ADMIN_PATH: ${path}`);
    await admin.goto(`${baseURL}${path}`);
    await assertHealthy(admin, `Admin ${path}`);
  }
  await admin.screenshot({ path: "operational-simulator.png", fullPage: true });

  const employeeContext = await browser.newContext({ ...torontoContext, viewport: { width: 412, height: 915 } });
  const employee = await employeeContext.newPage();
  const employeeErrors = watchErrors(employee, "Employee");
  await signIn(employee, workerEmail, workerPassword);
  await employee.waitForURL("**/employee", { timeout: 30_000 });
  await assertHealthy(employee, "Employee home", true);
  await employee.goto(`${baseURL}/employee/route`);
  await expect(employee.locator(".route-list-item").first()).toBeVisible({ timeout: 30_000 });
  await assertHealthy(employee, "Employee route", true);
  await employee.locator(".route-list-item").first().click();
  await expect(employee.getByRole("button", { name: "Start" })).toBeEnabled();
  await employee.getByRole("button", { name: "Start" }).click();
  await expect(employee.getByText(/^(Active|IN PROGRESS)$/i).first()).toBeVisible({ timeout: 30_000 });
  employee.once("dialog", dialog => dialog.accept());
  await employee.getByRole("button", { name: "Finish" }).click();
  await expect(employee.getByText("Done", { exact: true })).toBeVisible({ timeout: 30_000 });
  await employee.screenshot({ path: "employee-live-route.png", fullPage: true });

  const customerMobileContext = await browser.newContext({ ...torontoContext, viewport: { width: 412, height: 915 } });
  const customerMobile = await customerMobileContext.newPage();
  const customerMobileErrors = watchErrors(customerMobile, "Customer mobile");
  await signIn(customerMobile, customerEmail, customerPassword);
  await customerMobile.waitForURL("**/customer", { timeout: 30_000 });
  await customerMobile.goto(`${baseURL}/customer/feedback`);
  await expect(customerMobile.getByRole("heading", { name: "Review completed services" })).toBeVisible({ timeout: 30_000 });
  await assertHealthy(customerMobile, "Customer feedback mobile", true);
  await expect(customerMobile.locator("textarea").first()).toBeVisible({ timeout: 30_000 });
  await customerMobile.locator(".star-button").nth(1).click();
  await customerMobile.locator("textarea").first().fill("The gate edge was missed. Please send the crew back to correct it.");
  await customerMobile.getByRole("button", { name: "Submit Review" }).click();
  const feedbackNotice = customerMobile.locator(".notice");
  await expect(feedbackNotice).toBeVisible({ timeout: 30_000 });
  const feedbackText = await feedbackNotice.innerText();
  console.log(`CUSTOMER_FEEDBACK_NOTICE: ${feedbackText}`);
  expect(feedbackText).toMatch(/Feedback saved/i);
  await customerMobile.screenshot({ path: "customer-feedback-result.png", fullPage: true });

  await customerMobile.goto(`${baseURL}/mobile/customer/requests`);
  await expect(customerMobile.getByRole("heading", { name: "What does your property need?" })).toBeVisible({ timeout: 30_000 });
  await assertHealthy(customerMobile, "Customer requests mobile", true);
  await customerMobile.getByRole("button", { name: /Return Visit/i }).click();
  await customerMobile.getByLabel(/Comments/).fill("Please review and correct the gate edge from the completed service.");
  await customerMobile.getByRole("button", { name: "Confirm & Send Request" }).click();
  await expect(customerMobile.getByText(/Return Visit sent to Admin/i)).toBeVisible({ timeout: 30_000 });

  for (const path of ["/mobile/customer", "/mobile/customer/payments", "/mobile/customer/requests", "/customer/feedback"]) {
    console.log(`QA_CUSTOMER_MOBILE_PATH: ${path}`);
    await customerMobile.goto(`${baseURL}${path}`);
    await assertHealthy(customerMobile, `Customer mobile ${path}`, true);
  }
  await customerMobile.screenshot({ path: "customer-feedback.png", fullPage: true });

  const customerDesktopContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const customerDesktop = await customerDesktopContext.newPage();
  const customerDesktopErrors = watchErrors(customerDesktop, "Customer desktop");
  await signIn(customerDesktop, customerEmail, customerPassword);
  await customerDesktop.waitForURL("**/customer", { timeout: 30_000 });
  for (const path of ["/customer", "/customer/payments", "/customer/invoices", "/customer/feedback"]) {
    console.log(`QA_CUSTOMER_DESKTOP_PATH: ${path}`);
    await customerDesktop.goto(`${baseURL}${path}`);
    await assertHealthy(customerDesktop, `Customer desktop ${path}`);
  }
  await customerDesktop.screenshot({ path: "customer-desktop-qa.png", fullPage: true });

  await admin.goto(`${baseURL}/admin/performance/simulator`);
  await expect(liveExceptions).toBeVisible();
  await expect(liveExceptions.getByText("Low ratings").locator("..").getByText("1", { exact: true })).toBeVisible({ timeout: 30_000 });
  const openTaskText = await liveExceptions.getByText("Open follow-up tasks").locator("..").locator("strong").innerText();
  const openTaskCount = Number(openTaskText.trim());
  console.log(`OPEN_FOLLOW_UP_TASKS: ${openTaskCount}`);
  expect(openTaskCount).toBeGreaterThanOrEqual(1);
  await expect(liveExceptions.getByText("Return requests").locator("..").getByText("1", { exact: true })).toBeVisible({ timeout: 30_000 });

  expect(adminErrors, adminErrors.join("\n")).toEqual([]);
  expect(employeeErrors, employeeErrors.join("\n")).toEqual([]);
  expect(customerMobileErrors, customerMobileErrors.join("\n")).toEqual([]);
  expect(customerDesktopErrors, customerDesktopErrors.join("\n")).toEqual([]);

  await customerDesktopContext.close();
  await customerMobileContext.close();
  await employeeContext.close();
  await adminContext.close();
});