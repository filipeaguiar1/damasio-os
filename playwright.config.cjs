const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'android-pixel', use: { ...devices['Pixel 7'] } },
    { name: 'android-compact', use: { ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } } },
    { name: 'pwa-like', use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, userAgent: `${devices['Pixel 7'].userAgent} DamasioOSAndroid/E2E`, locale: 'en-CA', timezoneId: 'America/Toronto' } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
