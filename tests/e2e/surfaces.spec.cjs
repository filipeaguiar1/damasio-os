const { test, expect } = require('@playwright/test');

const publicRoutes = ['/', '/mobile', '/mobile/login', '/login'];
const employeeExecutionVisitId = '5d717d5e-5540-41fd-b321-0ae309ceb93f';
const employeeExecutionEmployeeId = '0b33be2e-000e-457c-b875-8138aa364529';

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText || '';
    const url = request.url();
    const isExpectedNextNavigationAbort = errorText.includes('ERR_ABORTED') && url.includes('_rsc=');
    if (!isExpectedNextNavigationAbort) failures.push(`request: ${request.method()} ${url} ${errorText}`);
  });
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

async function resetEmployeeExecutionVisit() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const response = await fetch(`${url}/rest/v1/visits?id=eq.${employeeExecutionVisitId}&select=id,status,assigned_employee_id`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify({
      status: 'scheduled',
      started_at: null,
      finished_at: null,
      duration_seconds: null,
    }),
  });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || 'E2E Visit could not be reset.');
  return rows[0] || null;
}

async function signInMobile(page, email, password) {
  await page.goto('/mobile/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in securely/i }).click();
  await page.waitForURL(url => !url.pathname.endsWith('/mobile/login'), { timeout: 20_000 });
}

async function getEmployeeRouteVisit(page, visitId) {
  return page.evaluate(async targetVisitId => {
    const storageKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (!storageKey) throw new Error('Supabase session was not found.');
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const session = stored.currentSession || stored;
    const token = session?.access_token;
    if (!token) throw new Error('Supabase access token was not found.');

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const today = `${values.year}-${values.month}-${values.day}`;

    const response = await fetch(`/api/mobile/employee/route?date=${encodeURIComponent(today)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Employee route could not be loaded.');
    return {
      employeeId: payload.employee?.id || null,
      visit: (payload.stops || []).find(stop => stop.visitId === targetVisitId) || null,
    };
  }, visitId);
}

for (const [role, [email, password]] of Object.entries(credentials)) {
  test(`${role} canonical authenticated smoke`, async ({ page }) => {
    test.skip(!email || !password, `${role} E2E credentials are not configured`);
    const failures = collectRuntimeFailures(page);
    await signInMobile(page, email, password);
    await expect(page.locator('main')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    expect(failures, failures.join('\n')).toEqual([]);
  });
}

test('employee canonical execution smoke', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Visit execution mutates shared E2E data and runs once.');
  const [email, password] = credentials.employee;
  test.skip(!email || !password, 'employee E2E credentials are not configured');

  const preparedVisit = await resetEmployeeExecutionVisit();
  if (preparedVisit) {
    expect(preparedVisit.assigned_employee_id).toBe(employeeExecutionEmployeeId);
    expect(preparedVisit.status).toBe('scheduled');
  }

  const failures = collectRuntimeFailures(page);
  await signInMobile(page, email, password);
  await page.goto('/mobile/employee', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toBeVisible();

  const routeState = await getEmployeeRouteVisit(page, employeeExecutionVisitId);

  expect(routeState.employeeId).toBe(employeeExecutionEmployeeId);
  const visit = routeState.visit;
  expect(visit, `${employeeExecutionVisitId} must be visible in the Employee route`).toBeTruthy();
  expect(visit.serviceName).toBe('Weekly Lawn Care');
  expect(visit.status).toBe('scheduled');

  await page.getByRole('button', { name: /^list$/i }).click();
  await page.getByRole('button', { name: /weekly lawn care/i }).click();
  await expect(page.getByText('Weekly Lawn Care')).toBeVisible();
  await expect(page.getByText(/open/i)).toBeVisible();

  await page.getByRole('button', { name: /^start$/i }).click();
  await expect(page.getByText(/service started and synchronized/i)).toBeVisible();

  await expect.poll(async () => (await getEmployeeRouteVisit(page, employeeExecutionVisitId)).visit?.status || null, { timeout: 15_000 }).toBe('in_progress');
  await expect(page.getByRole('button', { name: /^finish$/i })).toBeEnabled({ timeout: 15_000 });

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /^finish$/i }).click();
  await expect(page.getByText(/done\. every device was updated/i)).toBeVisible();

  await expect.poll(async () => (await getEmployeeRouteVisit(page, employeeExecutionVisitId)).visit?.status || null, { timeout: 15_000 }).toBe('completed');

  expect(failures, failures.join('\n')).toEqual([]);
});
