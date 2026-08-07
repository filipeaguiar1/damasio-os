import { test, expect, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
const torontoContext = { timezoneId: "America/Toronto" } as const;

test.setTimeout(420_000);

async function signIn(page: Page, email: string, password: string) {
  let lastMessage = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${baseURL}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    try {
      await page.waitForURL(url => url.pathname !== "/login", { timeout: 15_000 });
      return;
    } catch {
      lastMessage = (await page.locator("body").innerText().catch(() => "")).slice(-600);
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
  throw new Error(`Sign in did not complete for ${email}. ${lastMessage}`.trim());
}

async function authRequest<T>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let lastError = "Request failed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(async ({ path, init }) => {
        const authKey = Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
        if (!authKey) throw new Error("Supabase browser session was not found.");
        const stored = JSON.parse(window.localStorage.getItem(authKey) || "null");
        const accessToken = stored?.access_token || stored?.currentSession?.access_token;
        if (!accessToken) throw new Error("Supabase access token was not found.");
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch(path, {
            method: init?.method || "GET",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            signal: controller.signal,
            body: init?.body === undefined ? undefined : JSON.stringify(init.body),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = result.error || `${response.status} ${path}`;
            throw new Error(`HTTP_${response.status}:${message}`);
          }
          return result;
        } finally {
          window.clearTimeout(timeout);
        }
      }, { path, init }) as T;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /HTTP_(400|401):Bad Request/i.test(lastError);
      if (attempt === 2 || !retryable) {
        throw new Error(lastError.replace(/^.*HTTP_\d+:/, ""));
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw new Error(lastError.replace(/^.*HTTP_\d+:/, ""));
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

  let simulation: any = null;
  for (let attempt = 0; attempt < 3 && !simulation; attempt += 1) {
    const removal = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
      method: "POST",
      body: { action: "remove" },
    });
    expect(removal.removed).toBe(true);
    await expect.poll(async () => {
      const result = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator");
      return Boolean(result.status?.exists);
    }, { timeout: 60_000 }).toBe(false);
    await adminDesktop.waitForTimeout(750 * (attempt + 1));
    try {
      simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
        method: "POST",
        body: { action: "create" },
      });
    } catch (error) {
      if (attempt === 2 || !/simulation already exists/i.test(String(error))) throw error;
    }
  }
  expect(simulation?.created).toBe(true);
  expect(simulation.workers?.length).toBe(2);
  const workerEmail = String(simulation.workers[0].email);
  const workerPassword = String(simulation.workers[0].password);

  const employeeDesktopContext = await browser.newContext({
    ...torontoContext,
    viewport: { width: 1440, height: 1000 },
    geolocation: { latitude: 43.2557, longitude: -79.8711 },
    permissions: ["geolocation"],
  });
  const employeeDesktop = await employeeDesktopContext.newPage();
  await signIn(employeeDesktop, workerEmail, workerPassword);
  await employeeDesktop.waitForURL("**/employee", { timeout: 30_000 });

  const routeDate = String(simulation.operational?.liveDate || "");
  expect(routeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

  // Creating/removing the simulator performs long service-role work. Re-authenticate the
  // Admin before the independent cross-role comparison so the test never reuses a stale JWT.
  await adminDesktop.goto(`${baseURL}/login`);
  await adminDesktop.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  await adminDesktop.reload();
  await adminDesktop.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await adminDesktop.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await adminDesktop.getByRole("button", { name: "Sign In" }).click();
  await adminDesktop.waitForURL("**/admin", { timeout: 30_000 });

  const adminRoutes = await authRequest<any>(adminDesktop, `/api/admin/routes?date=${encodeURIComponent(routeDate)}`);
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

  // Employee web and mobile are two surfaces of the same authenticated worker.
  // Keep them in one browser context so the test validates route synchronization,
  // not artificial competition between separately refreshed test sessions.
  const employeeMobile = await employeeDesktopContext.newPage();
  await employeeMobile.setViewportSize({ width: 412, height: 915 });
  await employeeMobile.goto(`${baseURL}/mobile/employee`);

  await employeeDesktop.goto(`${baseURL}/employee/route?view=map&date=${encodeURIComponent(routeDate)}`);
  await employeeDesktop.waitForLoadState("domcontentloaded");
  await employeeDesktop.screenshot({ path: "canonical-employee-web.png", fullPage: true });
  console.log("EMPLOYEE_WEB_URL:", employeeDesktop.url());
  console.log("EMPLOYEE_WEB_BODY:", (await employeeDesktop.locator("body").innerText()).slice(0, 1200));

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=view`);
  await adminDesktop.locator('input[type="date"]').first().fill(routeDate);
  const workerRouteButton = adminDesktop.locator(`.official-route-worker-button[data-employee-id="${worker.id}"]`);
  await expect(workerRouteButton).toBeVisible({ timeout: 30_000 });
  await expect(workerRouteButton).toContainText(String(employeeSnapshot.stops.length));
  await workerRouteButton.click();

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

  const originalJobIds = restoredEmployee.stops.map((stop: any) => String(stop.jobId || "")).filter(Boolean);
  expect(originalJobIds.length).toBe(restoredEmployee.stops.length);
  const reducedJobIds = originalJobIds.slice(0, -1);
  const adminRemove = await authRequest<any>(adminDesktop, "/api/admin/route-advisor", {
    method: "POST",
    body: {
      action: "publish",
      employeeId: worker.employeeId || worker.id,
      crewId: worker.crewId,
      routeDate,
      orderedJobIds: reducedJobIds,
      sourceVisitIds: [],
      origin: restoredEmployee.origin,
    },
  });
  expect(adminRemove.count).toBe(reducedJobIds.length);
  expect(adminRemove.routeVersion).toBeGreaterThan(restoredEmployee.routeVersion);
  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, adminRemove.routeVersion);
  }
  for (const [page, label] of [
    [adminDesktop, "Admin web after Advisor remove"],
    [adminMobile, "Admin mobile after Advisor remove"],
    [employeeDesktop, "Employee web after Advisor remove"],
    [employeeMobile, "Employee mobile after Advisor remove"],
  ] as const) {
    await assertCanonicalScreen(page, adminRemove.routeVersion, reducedJobIds.length, label);
  }

  const adminAdd = await authRequest<any>(adminDesktop, "/api/admin/route-advisor", {
    method: "POST",
    body: {
      action: "publish",
      employeeId: worker.employeeId || worker.id,
      crewId: worker.crewId,
      routeDate,
      orderedJobIds: originalJobIds,
      sourceVisitIds: [],
      origin: adminRemove.origin || restoredEmployee.origin,
    },
  });
  expect(adminAdd.count).toBe(originalJobIds.length);
  expect(adminAdd.routeVersion).toBeGreaterThan(adminRemove.routeVersion);
  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, adminAdd.routeVersion);
  }
  for (const [page, label] of [
    [adminDesktop, "Admin web after Advisor add"],
    [adminMobile, "Admin mobile after Advisor add"],
    [employeeDesktop, "Employee web after Advisor add"],
    [employeeMobile, "Employee mobile after Advisor add"],
  ] as const) {
    await assertCanonicalScreen(page, adminAdd.routeVersion, originalJobIds.length, label);
  }

  await adminDesktop.screenshot({ path: "canonical-admin-web.png", fullPage: true });
  await adminMobile.screenshot({ path: "canonical-admin-mobile.png", fullPage: true });
  await employeeDesktop.screenshot({ path: "canonical-employee-web.png", fullPage: true });
  await employeeMobile.screenshot({ path: "canonical-employee-mobile.png", fullPage: true });

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=advisor`);
  await expect(adminDesktop.getByText("Create, add, reorder or remove houses.")).toBeVisible({ timeout: 30_000 });
  await adminDesktop.locator(".advisor-controls select").selectOption(worker.id);
  await adminDesktop.locator('.advisor-controls input[type="date"]').fill(routeDate);
  await expect(adminDesktop.locator(".advisor-house-picker")).toContainText(`route ${originalJobIds.length}/`, { timeout: 30_000 });

  await authRequest(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  });

  await adminMobileContext.close();
  await employeeDesktopContext.close();
  await adminDesktopContext.close();
});
