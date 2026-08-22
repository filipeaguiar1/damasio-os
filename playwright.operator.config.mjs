import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.QA_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/browser-operator",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report/operator", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report/operator", open: "never" }]],
  use: {
    baseURL,
    locale: "en-CA",
    timezoneId: "America/Toronto",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  outputDir: "test-results/browser-operator",
  projects: [
    { name: "operator-desktop", testIgnore: /.*employee.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "employee-mobile", testMatch: /.*employee.*\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
});
