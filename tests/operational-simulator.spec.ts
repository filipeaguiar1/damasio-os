import { test, expect } from "@playwright/test";

test.setTimeout(240_000);

test("admin creates two months, employee completes a house and customer reviews it", async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  await admin.goto("http://127.0.0.1:3000/login");
  await admin.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await admin.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await admin.getByRole("button", { name: "Sign In" }).click();
  await admin.waitForTimeout(1500);
  await admin.goto("http://127.0.0.1:3000/admin/performance/simulator");
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
    await expect(admin.getByText(/simulation customers/i)).toBeVisible({ timeout: 60_000 });
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

  const employeeContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const employee = await employeeContext.newPage();
  await employee.goto("http://127.0.0.1:3000/login");
  await employee.getByLabel("Email").fill(workerEmail);
  await employee.getByLabel("Password").fill(workerPassword);
  await employee.getByRole("button", { name: "Sign In" }).click();
  await employee.waitForURL("**/employee", { timeout: 30_000 });
  await employee.goto("http://127.0.0.1:3000/employee/route");
  await expect(employee.locator(".route-list-item").first()).toBeVisible({ timeout: 30_000 });
  await employee.locator(".route-list-item").first().click();
  await expect(employee.getByRole("button", { name: "Start" })).toBeEnabled();
  await employee.getByRole("button", { name: "Start" }).click();
  await expect(employee.getByText("IN PROGRESS", { exact: true })).toBeVisible({ timeout: 30_000 });
  employee.once("dialog", dialog => dialog.accept());
  await employee.getByRole("button", { name: "Finish" }).click();
  await expect(employee.getByText("Done", { exact: true })).toBeVisible({ timeout: 30_000 });
  await employee.screenshot({ path: "employee-live-route.png", fullPage: true });

  const customerContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const customer = await customerContext.newPage();
  customer.on("console", message => console.log(`CUSTOMER_BROWSER_${message.type().toUpperCase()}: ${message.text()}`));
  await customer.goto("http://127.0.0.1:3000/login");
  await customer.getByLabel("Email").fill(customerEmail);
  await customer.getByLabel("Password").fill(customerPassword);
  await customer.getByRole("button", { name: "Sign In" }).click();
  await customer.waitForURL("**/customer", { timeout: 30_000 });
  await customer.goto("http://127.0.0.1:3000/customer/feedback");
  await expect(customer.getByRole("heading", { name: "Review completed services" })).toBeVisible({ timeout: 30_000 });
  await expect(customer.locator("textarea").first()).toBeVisible({ timeout: 30_000 });
  await customer.locator("textarea").first().fill("Simulation customer confirmed the completed service and employee photo.");
  await customer.getByRole("button", { name: "Submit Review" }).click();
  const feedbackNotice = customer.locator(".notice");
  await expect(feedbackNotice).toBeVisible({ timeout: 30_000 });
  const feedbackText = await feedbackNotice.innerText();
  console.log(`CUSTOMER_FEEDBACK_NOTICE: ${feedbackText}`);
  await customer.screenshot({ path: "customer-feedback-result.png", fullPage: true });
  expect(feedbackText).toMatch(/Feedback saved/i);

  await customer.goto("http://127.0.0.1:3000/mobile/customer/requests");
  await expect(customer.getByRole("heading", { name: "What does your property need?" })).toBeVisible({ timeout: 30_000 });
  await customer.getByRole("button", { name: /Return Visit/i }).click();
  await customer.getByLabel(/Comments/).fill("Please review the gate edge shown in the completed service history.");
  await customer.getByRole("button", { name: "Confirm & Send Request" }).click();
  await expect(customer.getByText(/Return Visit sent to Admin/i)).toBeVisible({ timeout: 30_000 });
  await customer.screenshot({ path: "customer-feedback.png", fullPage: true });

  await admin.reload();
  await expect(admin.getByText("Live Simulation Status")).toBeVisible();
  await admin.screenshot({ path: "operational-simulator.png", fullPage: true });

  await customerContext.close();
  await employeeContext.close();
  await adminContext.close();
});
