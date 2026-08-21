import { expect, test } from "@playwright/test";
import {
  assertNoMutableResidue,
  browserAuthRequest,
  cleanupMutableOperatorFixture,
  createMutableOperatorFixture,
  requireOperatorEnvironment,
  serviceClient,
  signInBrowser,
  type OperatorFixture,
} from "./fixtures";

test("customer Browser Operator smoke sees only the QA tenant fixture", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { namespace: baseNamespace } = requireOperatorEnvironment();
  const db = serviceClient();
  let fixture: OperatorFixture | null = null;

  try {
    fixture = await createMutableOperatorFixture(db, baseNamespace);
    await signInBrowser(page, fixture.customer.email, fixture.customer.password);

    for (const target of [
      { name: "customer-home", path: "/customer" },
      { name: "customer-history", path: "/customer/history" },
      { name: "customer-mobile", path: "/mobile/customer" },
    ]) {
      await page.goto(target.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
      await testInfo.attach(target.name, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }

    const board = await browserAuthRequest<any>(page, "/api/customer/portal-board");
    expect(JSON.stringify(board)).toContain(fixture.customer.customerId);
    expect(JSON.stringify(board)).toContain(fixture.customer.propertyId);
    expect(JSON.stringify(board)).toContain(fixture.namespace);
    expect(JSON.stringify(board)).not.toMatch(/sk_live_|stripe_live/i);
  } finally {
    await cleanupMutableOperatorFixture(db, fixture);
    if (fixture) await assertNoMutableResidue(db, fixture);
  }
});

test("master Browser Operator smoke is read-only when QA Master credentials are configured", async ({ page }, testInfo) => {
  requireOperatorEnvironment();
  const masterEmail = process.env.QA_MASTER_EMAIL || process.env.E2E_MASTER_EMAIL || "";
  const masterPassword = process.env.QA_MASTER_PASSWORD || process.env.E2E_MASTER_PASSWORD || "";
  test.skip(!masterEmail || !masterPassword, "QA Master credentials are not configured for this environment.");

  await signInBrowser(page, masterEmail, masterPassword);
  for (const target of [
    { name: "master-home", path: "/master" },
    { name: "master-customers", path: "/master/customers" },
    { name: "master-payouts", path: "/master/payouts" },
  ]) {
    const response = await page.goto(target.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    expect(response?.status(), `${target.path} returned a server error`).toBeLessThan(500);
    await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
    await testInfo.attach(target.name, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});
