const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');

const publicRoutes = ['/', '/mobile', '/mobile/login', '/login'];
const employeeExecutionServiceName = 'Weekly Lawn Care';

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

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function supabaseHeaders(prefer) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  };
}

async function supabaseRest(path, options = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase E2E service credentials are not configured.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: supabaseHeaders(options.prefer),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || `${options.method || 'GET'} ${path} failed`);
  return data;
}

async function insertOne(table, body) {
  const rows = await supabaseRest(`${table}?select=*`, {
    method: 'POST',
    prefer: 'return=representation',
    body,
  });
  return rows[0];
}

async function ensureEmployeeExecutionVisit(employeeEmail) {
  const today = torontoDateKey();
  const employees = await supabaseRest(
    `employees?email=eq.${encodeURIComponent(employeeEmail)}&active=eq.true&select=id,crew_id,company_id,organization_id,email`,
  );
  const employee = employees[0];
  if (!employee) throw new Error(`Employee E2E row was not found for ${employeeEmail}.`);

  const companyId = employee.company_id || employee.organization_id;
  if (!companyId) throw new Error('Employee E2E is not linked to a company.');

  const suffix = randomUUID().slice(0, 8);
  const customer = await insertOne('customers', {
    organization_id: companyId,
    full_name: `E2E Execution Customer ${suffix}`,
    email: `employee-execution-${suffix}@example.invalid`,
    phone: '+1 416 555 0199',
  });
  const property = await insertOne('properties', {
    organization_id: companyId,
    customer_id: customer.id,
    address_line1: `E2E ${suffix} Test Street`,
    city: 'Hamilton',
    province: 'ON',
    postal_code: 'L8P 1H6',
    country: 'Canada',
    lot_size: 'small',
    grass_height: '3in',
  });
  const job = await insertOne('jobs', {
    organization_id: companyId,
    customer_id: customer.id,
    property_id: property.id,
    service_name: employeeExecutionServiceName,
    frequency: 'weekly',
    active: true,
    next_visit_date: today,
  });

  const crewFilter = employee.crew_id ? `crew_id=eq.${employee.crew_id}` : 'crew_id=is.null';
  const routes = await supabaseRest(
    `routes?organization_id=eq.${companyId}&route_date=eq.${today}&${crewFilter}&select=id,crew_id,route_date&limit=1`,
  );
  const route = routes[0] || await insertOne('routes', {
    organization_id: companyId,
    crew_id: employee.crew_id,
    route_date: today,
    status: 'published',
  });

  const routeVisits = await supabaseRest(
    `visits?route_id=eq.${route.id}&select=route_order&order=route_order.desc.nullslast&limit=1`,
  );
  const routeOrder = Number(routeVisits[0]?.route_order || 0) + 1;
  const visit = await insertOne('visits', {
    organization_id: companyId,
    job_id: job.id,
    route_id: route.id,
    customer_id: customer.id,
    property_id: property.id,
    crew_id: employee.crew_id,
    assigned_employee_id: employee.id,
    scheduled_date: today,
    status: 'scheduled',
    route_order: routeOrder,
  });

  return { employee, visit };
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
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, 'Supabase E2E service credentials are not configured');

  const prepared = await ensureEmployeeExecutionVisit(email);
  expect(prepared.visit.status).toBe('scheduled');
  expect(prepared.visit.assigned_employee_id).toBe(prepared.employee.id);

  const failures = collectRuntimeFailures(page);
  await signInMobile(page, email, password);
  await page.goto('/mobile/employee', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toBeVisible();

  const routeState = await getEmployeeRouteVisit(page, prepared.visit.id);

  expect(routeState.employeeId).toBe(prepared.employee.id);
  const visit = routeState.visit;
  expect(visit, `${prepared.visit.id} must be visible in the Employee route`).toBeTruthy();
  expect(visit.serviceName).toBe(employeeExecutionServiceName);
  expect(visit.status).toBe('scheduled');

  await page.getByRole('button', { name: /^list$/i }).click();
  await page.getByRole('button', { name: new RegExp(employeeExecutionServiceName, 'i') }).click();
  await expect(page.getByText(employeeExecutionServiceName)).toBeVisible();
  await expect(page.locator('.mobile-status')).toHaveText('Open');

  await page.getByRole('button', { name: /^start$/i }).click();

  await expect.poll(async () => (await getEmployeeRouteVisit(page, prepared.visit.id)).visit?.status || null, { timeout: 15_000 }).toBe('in_progress');
  await expect(page.getByRole('button', { name: /^finish$/i })).toBeEnabled({ timeout: 15_000 });

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /^finish$/i }).click();
  await expect(page.getByText(/done\. every device was updated/i)).toBeVisible();

  await expect.poll(async () => (await getEmployeeRouteVisit(page, prepared.visit.id)).visit?.status || null, { timeout: 15_000 }).toBe('completed');

  expect(failures, failures.join('\n')).toEqual([]);
});
