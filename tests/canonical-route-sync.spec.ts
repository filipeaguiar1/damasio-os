import { test, expect, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
const torontoContext = { timezoneId: "America/Toronto" } as const;

test.setTimeout(420_000);

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

async function authRequest<T>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return page.evaluate(async ({ path, init }) => {
    const authKey = Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
    if (!authKey) throw new Error("Supabase browser session was not found.");
    const stored = JSON.parse(window.localStorage.getItem(authKey) || "null");
    const accessToken = stored?.access_token || stored?.currentSession?.access_token;
    if (!accessToken) throw new Error("Supabase access token was not found.");
    const response = await fetch(path, {
      method: init?.method || "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `${response.status} ${path}`);
    return result;
  }, { path, init }) as Promise<T>;
}

async function waitForVersion(page: Page, routeId: string, version: number) {
  await expect.poll(async () => {
    const snapshot = await authRequest<any>(page, `/api/map/canonical-route?routeId=${encodeURIComponent(routeId)}`);
    return snapshot.routeVersion;
  }, { timeout: 30_000 }).toBe(version);
}

async function assertCanonicalScreen(page: Page, version: number, stopCount: number, label: string) {
  await expect(page.getByText(`Canonical route v${version}`, { exact: false }).first(), label).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".employee-map-marker"), `${label} marker count`).toHaveCount(stopCount, { timeout: 30_000 });
  await expect(page.locator("body"), `${label} retired demo`).not.toContainText(/55 York Blvd|55 York Boulevard/i);
}

function snapshotIdentity(snapshot: any) {
  return {
    routeId: snapshot.routeId,
    routeVersion: snapshot.routeVersion,
    origin: snapshot.origin,
    orderedVisitIds: snapshot.orderedVisitIds,
    routeOrder: snapshot.routeOrder,
    stops: snapshot.stops.map((stop: any) => ({
      visitId: stop.visitId,
      routeOrder: stop.routeOrder,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      status: stop.status,
    })),
    geometry: snapshot.geometry,
  };
}

test("Admin and Employee web/mobile replace one canonical route snapshot", async ({ browser }) => {
  const adminDesktopContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const adminDesktop = await adminDesktopContext.newPage();
  await signIn(adminDesktop, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await adminDesktop.waitForURL("**/admin", { timeout: 30_000 });

  await authRequest(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  }).catch(() => undefined);
  const simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "create" },
  });
  expect(simulation.created).toBe(true);
  expect(simulation.workers?.length).toBe(2);
  const workerEmail = String(simulation.workers[0].email);
  const workerPassword = String(simulation.workers[0].password);

  const employeeDesktopContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });
  const employeeDesktop = await employeeDesktopContext.newPage();
  await signIn(employeeDesktop, workerEmail, workerPassword);
  await employeeDesktop.waitForURL("**/employee", { timeout: 30_000 });

  const routeDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const employeeSnapshot = await authRequest<any>(employeeDesktop, `/api/map/canonical-route?date=${routeDate}`);
  expect(employeeSnapshot.orderedVisitIds.length).toBeGreaterThanOrEqual(2);
  expect(employeeSnapshot.stops.every((stop: any, index: number) =>
    stop.visitId === employeeSnapshot.orderedVisitIds[index]
    && stop.routeOrder === index + 1
    && /Canada$/i.test(stop.address))).toBe(true);
  expect(JSON.stringify(employeeSnapshot)).not.toMatch(/55 York Blvd|55 York Boulevard/i);
  expect(employeeSnapshot.origin).toBeTruthy();
  expect(employeeSnapshot.stops.every((stop: any) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))).toBe(true);
  expect(employeeSnapshot.geometryStatus).toBe("ready");

  const adminRoutes = await authRequest<any>(adminDesktop, "/api/admin/routes");
  const worker = (adminRoutes.employees || []).find((item: any) =>
    String(item.email || "").toLowerCase() === workerEmail.toLowerCase());
  expect(worker).toBeTruthy();

  const adminSnapshot = await authRequest<any>(adminDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  expect(snapshotIdentity(adminSnapshot)).toEqual(snapshotIdentity(employeeSnapshot));

  const adminMobileContext = await browser.newContext({ ...torontoContext, viewport: { width: 412, height: 915 } });
  const adminMobile = await adminMobileContext.newPage();
  await signIn(adminMobile, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await adminMobile.waitForURL("**/admin", { timeout: 30_000 });
  await adminMobile.goto(`${baseURL}/mobile/admin/routes`);
  await adminMobile.locator("select").first().selectOption(worker.id);
  await adminMobile.locator('input[type="date"]').first().fill(routeDate);

  const employeeMobileContext = await browser.newContext({ ...torontoContext, viewport: { width: 412, height: 915 }, geolocation: { latitude: 43.2557, longitude: -79.8711 }, permissions: ["geolocation"] });
  const employeeMobile = await employeeMobileContext.newPage();
  await signIn(employeeMobile, workerEmail, workerPassword);
  await employeeMobile.waitForURL("**/employee", { timeout: 30_000 });
  await employeeMobile.goto(`${baseURL}/mobile/employee`);

  await employeeDesktop.goto(`${baseURL}/employee/route?view=map`);

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=view`);
  await adminDesktop.locator('input[type="date"]').first().fill(routeDate);
  const workerMarker = adminDesktop.locator(`.studio-leaflet-crew[title="${worker.name}"]`).first();
  await expect(workerMarker).toBeVisible({ timeout: 30_000 });
  await workerMarker.click();

  for (const [page, label] of [
    [adminDesktop, "Admin web"],
    [adminMobile, "Admin mobile"],
    [employeeDesktop, "Employee web"],
    [employeeMobile, "Employee mobile"],
  ] as const) {
    await assertCanonicalScreen(page, employeeSnapshot.routeVersion, employeeSnapshot.stops.length, label);
  }

  const screenSnapshots = await Promise.all([
    authRequest<any>(adminDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`),
    authRequest<any>(adminMobile, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`),
    authRequest<any>(employeeDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`),
    authRequest<any>(employeeMobile, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`),
  ]);
  for (const snapshot of screenSnapshots) {
    expect(snapshotIdentity(snapshot)).toEqual(snapshotIdentity(employeeSnapshot));
  }

  await employeeMobile.getByRole("button", { name: /Smart Route/i }).click();
  await employeeMobile.getByRole("button", { name: /Select all pending/i }).click();
  await employeeMobile.getByRole("button", { name: /Preview Smart Route/i }).click();
  await expect(employeeMobile.getByText(/Smart Route preview · not published/i)).toBeVisible({ timeout: 30_000 });
  await employeeMobile.getByRole("button", { name: "Apply Smart Route" }).click();

  await expect.poll(async () => {
    const snapshot = await authRequest<any>(employeeMobile, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
    return snapshot.routeVersion;
  }, { timeout: 45_000 }).toBeGreaterThan(employeeSnapshot.routeVersion);

  const smartSnapshot = await authRequest<any>(employeeMobile, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  const reversedOrder = smartSnapshot.orderedVisitIds;
  const employeeVersion = smartSnapshot.routeVersion;

  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, employeeVersion);
  }
  for (const [page, label] of [
    [adminDesktop, "Admin web after Employee change"],
    [adminMobile, "Admin mobile after Employee change"],
    [employeeDesktop, "Employee web after Employee change"],
    [employeeMobile, "Employee mobile after Employee change"],
  ] as const) {
    await assertCanonicalScreen(page, employeeVersion, reversedOrder.length, label);
  }

  const adminCurrent = await authRequest<any>(adminDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  expect(adminCurrent.orderedVisitIds).toEqual(reversedOrder);
  const adminWrite = await authRequest<any>(adminDesktop, "/api/map/canonical-route/order", {
    method: "POST",
    body: {
      action: "apply",
      routeId: employeeSnapshot.routeId,
      orderedVisitIds: employeeSnapshot.orderedVisitIds,
      origin: employeeSnapshot.origin,
      expectedVersion: adminCurrent.routeVersion,
    },
  });
  expect(adminWrite.appliedOrder).toEqual(employeeSnapshot.orderedVisitIds);

  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, adminWrite.routeVersion);
  }
  const restoredEmployee = await authRequest<any>(employeeDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  expect(restoredEmployee.orderedVisitIds).toEqual(employeeSnapshot.orderedVisitIds);

  await adminDesktop.screenshot({ path: "canonical-admin-web.png", fullPage: true });
  await adminMobile.screenshot({ path: "canonical-admin-mobile.png", fullPage: true });
  await employeeDesktop.screenshot({ path: "canonical-employee-web.png", fullPage: true });
  await employeeMobile.screenshot({ path: "canonical-employee-mobile.png", fullPage: true });

  await authRequest(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  });

  await employeeMobileContext.close();
  await adminMobileContext.close();
  await employeeDesktopContext.close();
  await adminDesktopContext.close();
});
