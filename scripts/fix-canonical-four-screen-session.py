from pathlib import Path

path = Path("tests/canonical-route-sync.spec.ts")
text = path.read_text()

replacements = [
(
'''  const employeeDesktopContext = await browser.newContext({ ...torontoContext, viewport: { width: 1440, height: 1000 } });''',
'''  const employeeDesktopContext = await browser.newContext({
    ...torontoContext,
    viewport: { width: 1440, height: 1000 },
    geolocation: { latitude: 43.2557, longitude: -79.8711 },
    permissions: ["geolocation"],
  });'''
),
(
'''  const employeeMobileContext = await browser.newContext({ ...torontoContext, viewport: { width: 412, height: 915 }, geolocation: { latitude: 43.2557, longitude: -79.8711 }, permissions: ["geolocation"] });
  const employeeMobile = await employeeMobileContext.newPage();
  await signIn(employeeMobile, workerEmail, workerPassword);
  await employeeMobile.waitForURL("**/employee", { timeout: 30_000 });
  await employeeMobile.goto(`${baseURL}/mobile/employee`);

  await employeeDesktop.goto(`${baseURL}/employee/route?view=map&date=${encodeURIComponent(routeDate)}`);
  const employeeMapTab = employeeDesktop.getByRole("button", { name: "Map", exact: true });
  await expect(employeeMapTab).toBeVisible({ timeout: 30_000 });
  await employeeMapTab.click();''',
'''  // Employee web and mobile are two surfaces of the same authenticated worker.
  // Keep them in one browser context so the test validates route synchronization,
  // not artificial competition between separately refreshed test sessions.
  const employeeMobile = await employeeDesktopContext.newPage();
  await employeeMobile.setViewportSize({ width: 412, height: 915 });
  await employeeMobile.goto(`${baseURL}/mobile/employee`);

  await employeeDesktop.goto(`${baseURL}/employee/route?view=map&date=${encodeURIComponent(routeDate)}`);
  await employeeDesktop.waitForLoadState("domcontentloaded");
  await employeeDesktop.screenshot({ path: "canonical-employee-web.png", fullPage: true });
  console.log("EMPLOYEE_WEB_URL:", employeeDesktop.url());
  console.log("EMPLOYEE_WEB_BODY:", (await employeeDesktop.locator("body").innerText()).slice(0, 1200));'''
),
(
'''  await employeeMobileContext.close();
  await adminMobileContext.close();
  await employeeDesktopContext.close();''',
'''  await adminMobileContext.close();
  await employeeDesktopContext.close();'''
),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match, found {count}: {old[:80]!r}")
    text = text.replace(old, new, 1)

path.write_text(text)
