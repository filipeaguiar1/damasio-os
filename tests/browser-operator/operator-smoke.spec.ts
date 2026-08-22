import { expect, test } from "@playwright/test";
import { signInBrowser } from "./fixture-env";
import { assertBrowserOperatorSafety } from "./safety";

const adminEmail = process.env.QA_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || "";
const adminPassword = process.env.QA_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD || "";

async function signInAdmin(page: any) {
  expect(adminEmail, "QA_ADMIN_EMAIL/E2E_ADMIN_EMAIL is required").toBeTruthy();
  expect(adminPassword, "QA_ADMIN_PASSWORD/E2E_ADMIN_PASSWORD is required").toBeTruthy();
  await signInBrowser(page, adminEmail, adminPassword);
}

test("QA operator can sign in and the app escapes account-check loading", async ({ page }, testInfo) => {
  assertBrowserOperatorSafety();
  await signInAdmin(page);
  await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
  await testInfo.attach("operator-home", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(page.url()).not.toMatch(/\/login(?:\?|$)/);
});

test("QA operator reload keeps the authenticated application recoverable", async ({ page }, testInfo) => {
  assertBrowserOperatorSafety();
  await signInAdmin(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
  await testInfo.attach("operator-after-reload", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(page.url()).not.toMatch(/\/login(?:\?|$)/);
});
