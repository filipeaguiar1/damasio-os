from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "lib/repositories/customerPropertyRepository.ts",
    '''async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function customerApi(options?: RequestInit) {
  const response = await fetch("/api/admin/customers", {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await accessToken()}`,
      ...(options?.headers || {}),
    },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Customer operation failed.");
  return result;
}''',
    '''async function accessToken(refresh = false) {
  const supabase = getSupabaseBrowserClient() as any;
  const response = refresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  if (response.error) throw new Error(response.error.message);
  const token = response.data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function customerApi(options?: RequestInit) {
  let response: Response | null = null;
  let result: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch("/api/admin/customers", {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await accessToken(attempt > 0)}`,
        ...(options?.headers || {}),
      },
      cache: "no-store",
    });
    result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    if (response.status !== 401 || attempt > 0) break;
  }
  throw new Error(result?.error || "Customer operation failed.");
}''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  expect(employeeSnapshot.geometryStatus).toBe("ready");

  const adminRoutes = await authRequest<any>(adminDesktop, `/api/admin/routes?date=${encodeURIComponent(routeDate)}`);''',
    '''  expect(employeeSnapshot.geometryStatus).toBe("ready");

  // Creating/removing the simulator performs long service-role work. Re-authenticate the
  // Admin before the independent cross-role comparison so the test never reuses a stale JWT.
  await adminDesktop.goto(`${baseURL}/login`);
  await adminDesktop.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  await adminDesktop.reload();
  await adminDesktop.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await adminDesktop.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await adminDesktop.getByRole("button", { name: "Sign In" }).click();
  await adminDesktop.waitForURL("**/admin", { timeout: 30_000 });

  const adminRoutes = await authRequest<any>(adminDesktop, `/api/admin/routes?date=${encodeURIComponent(routeDate)}`);''',
)

print("Admin session refresh and Customer API retry applied.")
