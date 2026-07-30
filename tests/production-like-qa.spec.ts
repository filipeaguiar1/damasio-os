import { test, expect, type Page } from "@playwright/test";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const runStripeQa = process.env.RUN_STRIPE_QA === "true";

test.setTimeout(420_000);

function watchErrors(page: Page, label: string) {
  const errors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(`${label}: ${message.text()}`);
  });
  page.on("pageerror", error => errors.push(`${label}: ${error.message}`));
  return errors;
}

async function assertHealthy(page: Page, label: string, mobile = false) {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Page crashed/i);
  await expect(page.locator("[data-nextjs-dialog], .nextjs-container-errors-header")).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    bodyText: document.body.innerText.trim().length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(layout.bodyText, `${label} rendered no meaningful content`).toBeGreaterThan(30);
  expect(layout.overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(mobile ? 4 : 8);
}

async function readAccessToken(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith("sb-") && item.endsWith("-auth-token"));
    if (!key) throw new Error("Supabase browser session was not found.");
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    const token = value.access_token || value.currentSession?.access_token || value.session?.access_token;
    if (!token) throw new Error("Supabase access token was not found.");
    return String(token);
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("production-like Admin, Employee, Customer and visual flow", async ({ browser, request }) => {
  if (runStripeQa) {
    const readinessResponse = await request.get(`${baseURL}/api/stripe/readiness`);
    expect(readinessResponse.ok()).toBeTruthy();
    const readiness = await readinessResponse.json();
    expect(readiness.configured).toBe(true);
    expect(readiness.mode, "Stripe QA refuses to run unless STRIPE_SECRET_KEY uses sk_test_").toBe("test");
    expect(readiness.testPaymentsAllowed).toBe(true);
    expect(readiness.webhookConfigured).toBe(true);
  }

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const adminErrors = watchErrors(admin, "Admin");
  await signIn(admin, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await admin.waitForURL(/\/admin/, { timeout: 45_000 });

  await admin.goto(`${baseURL}/admin/performance/simulator`);
  await expect(admin.getByRole("heading", { name: "Financial & Operational Simulator" })).toBeVisible({ timeout: 45_000 });
  const create = admin.getByRole("button", { name: "Create 2-Month Simulation" });
  const remove = admin.getByRole("button", { name: "Remove Simulation" });
  await expect.poll(async () => (await create.isEnabled().catch(() => false)) || (await remove.isEnabled().catch(() => false)), { timeout: 30_000 }).toBe(true);

  if (await remove.isEnabled()) {
    admin.once("dialog", dialog => dialog.accept());
    await remove.click();
    await expect(admin.getByText(/simulation customers/i)).toBeVisible({ timeout: 90_000 });
    await expect(create).toBeEnabled({ timeout: 30_000 });
  }

  await create.click();
  const simulationMessage = admin.locator(".payment-message");
  await expect(simulationMessage).toContainText(/completed eight weeks/i, { timeout: 180_000 });
  await expect(admin.getByText(/120 paid invoices/i)).toBeVisible();

  const codes = admin.locator("code");
  const workerEmail = (await codes.nth(0).innerText()).trim();
  const workerPassword = (await codes.nth(1).innerText()).trim();
  const customerEmail = (await codes.nth(4).innerText()).trim();
  const customerPassword = (await codes.nth(5).innerText()).trim();

  if (runStripeQa) {
    const adminToken = await readAccessToken(admin);
    const testInvoiceResponse = await admin.evaluate(async ({ token }) => {
      const response = await fetch("/api/admin/operational-simulator/stripe-test-invoice", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: response.status, body: await response.json() };
    }, { token: adminToken });
    expect(testInvoiceResponse.status).toBeLessThan(300);
    expect(testInvoiceResponse.body.invoice?.status).toBe("waiting_payment");

    const stripeQaResponse = await admin.evaluate(async ({ token, invoiceId }) => {
      const response = await fetch("/api/admin/operational-simulator/stripe-test-payment", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId }),
      });
      return { status: response.status, body: await response.json() };
    }, { token: adminToken, invoiceId: String(testInvoiceResponse.body.invoice.id) });
    console.log(`STRIPE_QA_RESULT: ${JSON.stringify(stripeQaResponse.body)}`);
    expect(stripeQaResponse.status).toBeLessThan(300);
    expect(stripeQaResponse.body.passed).toBe(true);
    expect(stripeQaResponse.body.stripeMode).toBe("test");
    expect(stripeQaResponse.body.invoice?.status).toBe("paid");
    expect(stripeQaResponse.body.payment?.status).toBe("paid");
    expect(stripeQaResponse.body.webhook?.received).toBe(true);
    expect(stripeQaResponse.body.wallet?.balanceCredits).toBeGreaterThanOrEqual(10);
  }

  for (const path of ["/admin", "/admin/customers", "/admin/routes?tab=view", "/admin/payments", "/admin/performance/simulator"]) {
    await admin.goto(`${baseURL}${path}`);
    await assertHealthy(admin, `Admin ${path}`);
  }
  await admin.screenshot({ path: "qa-admin-simulator.png", fullPage: true });

  const employeeContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const employee = await employeeContext.newPage();
  const employeeErrors = watchErrors(employee, "Employee");
  await signIn(employee, workerEmail, workerPassword);
  await employee.waitForURL(/\/employee/, { timeout: 45_000 });
  await employee.goto(`${baseURL}/employee/route`);
  await expect(employee.locator(".route-list-item").first()).toBeVisible({ timeout: 45_000 });
  await assertHealthy(employee, "Employee route", true);
  await employee.locator(".route-list-item").first().click();
  await employee.getByRole("button", { name: "Start" }).click();
  await expect(employee.getByText("IN PROGRESS", { exact: true })).toBeVisible({ timeout: 30_000 });
  employee.once("dialog", dialog => dialog.accept());
  await employee.getByRole("button", { name: "Finish" }).click();
  await expect(employee.getByText("Done", { exact: true })).toBeVisible({ timeout: 30_000 });
  await employee.screenshot({ path: "qa-employee-route.png", fullPage: true });

  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const customer = await customerContext.newPage();
  const customerErrors = watchErrors(customer, "Customer");
  await signIn(customer, customerEmail, customerPassword);
  await customer.waitForURL(/\/customer/, { timeout: 45_000 });
  await customer.goto(`${baseURL}/customer/payments`);
  await expect(customer.getByRole("heading", { name: "Payments & Visits" })).toBeVisible({ timeout: 45_000 });
  await assertHealthy(customer, "Customer payments");

  await customer.getByRole("button", { name: "Invoices", exact: true }).click();
  await expect(customer.getByRole("heading", { name: "Invoices" })).toBeVisible();
  if (runStripeQa) {
    const testInvoice = customer.locator(".billing-invoice-list article").filter({ hasText: "SIM-STRIPE-" });
    await expect(testInvoice).toBeVisible({ timeout: 45_000 });
    await expect(testInvoice).toContainText("$45.20");
    await expect(testInvoice).toContainText(/paid/i);
    await customer.getByRole("button", { name: "Account & Payments" }).click();
    await expect(customer.locator(".pv-summary article").first()).toContainText(/10\.00/, { timeout: 45_000 });
    await expect(customer.getByText(/Stripe test card/i)).toBeVisible({ timeout: 45_000 });
  }
  await customer.screenshot({ path: "qa-customer-payments.png", fullPage: true });

  for (const path of ["/customer", "/customer/invoices", "/customer/feedback", "/customer/settings"]) {
    await customer.goto(`${baseURL}${path}`);
    await assertHealthy(customer, `Customer ${path}`);
  }

  const mobileContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const mobile = await mobileContext.newPage();
  const mobileErrors = watchErrors(mobile, "Customer mobile");
  await signIn(mobile, customerEmail, customerPassword);
  await mobile.waitForURL(/\/customer/, { timeout: 45_000 });
  for (const path of ["/mobile/customer", "/mobile/customer/payments", "/mobile/customer/requests", "/customer/feedback"]) {
    await mobile.goto(`${baseURL}${path}`);
    await assertHealthy(mobile, `Customer mobile ${path}`, true);
  }
  await mobile.screenshot({ path: "qa-customer-mobile.png", fullPage: true });

  expect(adminErrors, adminErrors.join("\n")).toEqual([]);
  expect(employeeErrors, employeeErrors.join("\n")).toEqual([]);
  expect(customerErrors, customerErrors.join("\n")).toEqual([]);
  expect(mobileErrors, mobileErrors.join("\n")).toEqual([]);

  await mobileContext.close();
  await customerContext.close();
  await employeeContext.close();
  await adminContext.close();
});
