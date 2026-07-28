const { test, expect } = require('@playwright/test');

const publicRoutes = ['/', '/mobile', '/mobile/login', '/login'];

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  return failures;
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function assertTouchTargets(page) {
  const tooSmall = await page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll(nodes => nodes
    .map(node => {
      const rect = node.getBoundingClientRect();
      const label = node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 60) || node.tagName;
      return { label, width: rect.width, height: rect.height };
    })
    .filter(item => item.width > 0 && item.height > 0 && (item.width < 40 || item.height < 40))
    .slice(0, 20));
  expect(tooSmall, `undersized interactive targets: ${JSON.stringify(tooSmall)}`).toEqual([]);
}

test.describe('public surfaces', () => {
  for (const route of publicRoutes) {
    test(`${route} renders without broken runtime or layout`, async ({ page }, testInfo) => {
      const failures = collectRuntimeFailures(page);
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response?.status() || 200).toBeLessThan(500);
      await expect(page.locator('body')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      if (testInfo.project.name !== 'desktop-chromium') await assertTouchTargets(page);
      await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll('/', '_') || 'home'}.png`), fullPage: true });
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

test('mobile login fields and primary action are keyboard and touch usable', async ({ page }) => {
  await page.goto('/mobile/login', { waitUntil: 'networkidle' });
  const email = page.getByLabel('Email');
  const password = page.getByLabel('Password');
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  await email.fill('qa@example.invalid');
  await password.fill('not-a-real-password');
  const submit = page.getByRole('button', { name: /sign in securely/i });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await expect(submit).toBeFocused();
});

test('manifest and app shell support installed-PWA-like mode', async ({ page }) => {
  const manifestResponse = await page.request.get('/manifest.json');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.name || manifest.short_name).toBeTruthy();
  expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  await page.goto('/mobile', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
});

const credentials = {
  admin: [process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD],
  employee: [process.env.E2E_EMPLOYEE_EMAIL, process.env.E2E_EMPLOYEE_PASSWORD],
  customer: [process.env.E2E_CUSTOMER_EMAIL, process.env.E2E_CUSTOMER_PASSWORD],
};

for (const [role, [email, password]] of Object.entries(credentials)) {
  test(`${role} canonical authenticated smoke`, async ({ page }) => {
    test.skip(!email || !password, `${role} E2E credentials are not configured`);
    const failures = collectRuntimeFailures(page);
    await page.goto('/mobile/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in securely/i }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/mobile/login'), { timeout: 20_000 });
    await expect(page.locator('main')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
