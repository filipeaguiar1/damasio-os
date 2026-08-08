import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";

async function adminAccessToken() {
  expect(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();
  expect(ADMIN_EMAIL, "E2E_ADMIN_EMAIL is required").toBeTruthy();
  expect(ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD is required").toBeTruthy();

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.error || !login.data.session?.access_token) {
    throw new Error(login.error?.message || "Advanced simulator E2E could not authenticate the Admin.");
  }
  return login.data.session.access_token;
}

async function postSimulator(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
) {
  return request.post(`${APP_URL}/api/admin/operational-simulator/v2`, {
    headers: { authorization: `Bearer ${token}` },
    data: body,
  });
}

async function getSimulator(
  request: APIRequestContext,
  token: string,
  namespace: string,
) {
  return request.get(`${APP_URL}/api/admin/operational-simulator/v2?namespace=${encodeURIComponent(namespace)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

test.describe.configure({ mode: "serial" });

test("advanced simulator isolates namespaces and reset is idempotent", async ({ request }) => {
  test.setTimeout(20 * 60 * 1000);
  const token = await adminAccessToken();
  const suffix = Date.now().toString(36);
  const namespaceA = `e2e-a-${suffix}`;
  const namespaceB = `e2e-b-${suffix}`;

  const cleanup = async (namespace: string) => {
    const response = await postSimulator(request, token, { action: "reset", namespace });
    if (!response.ok()) {
      console.warn(`Advanced simulator cleanup ${namespace}: ${response.status()} ${await response.text()}`);
    }
  };

  await cleanup(namespaceA);
  await cleanup(namespaceB);

  try {
    const createA = await postSimulator(request, token, {
      action: "create",
      namespace: namespaceA,
      scenario: "baseline",
    });
    expect(createA.status(), await createA.text()).toBe(201);
    const createdA = await createA.json();
    expect(createdA.reconciliation?.passed).toBe(true);
    expect(createdA.operational?.customerCount).toBe(60);
    expect(createdA.operational?.workerCount).toBe(2);
    expect(createdA.operational?.completedVisits).toBe(480);
    expect(createdA.operational?.scheduledVisits).toBe(8);

    const duplicateA = await postSimulator(request, token, {
      action: "create",
      namespace: namespaceA,
      scenario: "baseline",
    });
    expect(duplicateA.status()).toBe(400);
    expect((await duplicateA.json()).error).toContain("already contains active canonical data");

    const createB = await postSimulator(request, token, {
      action: "create",
      namespace: namespaceB,
      scenario: "baseline",
    });
    expect(createB.status(), await createB.text()).toBe(201);
    const createdB = await createB.json();
    expect(createdB.reconciliation?.passed).toBe(true);
    expect(createdB.operational?.completedVisits).toBe(480);

    const resetA = await postSimulator(request, token, { action: "reset", namespace: namespaceA });
    expect(resetA.ok(), await resetA.text()).toBe(true);
    expect((await resetA.json()).removed).toBe(true);

    const statusA = await getSimulator(request, token, namespaceA);
    expect(statusA.ok(), await statusA.text()).toBe(true);
    expect((await statusA.json()).status?.exists).toBe(false);

    const statusB = await getSimulator(request, token, namespaceB);
    expect(statusB.ok(), await statusB.text()).toBe(true);
    const activeB = await statusB.json();
    expect(activeB.status?.exists).toBe(true);
    expect(activeB.status?.customerCount).toBe(60);
    expect(activeB.status?.completedVisits).toBe(480);

    const reconcileB = await postSimulator(request, token, {
      action: "reconcile",
      namespace: namespaceB,
      scenario: "baseline",
    });
    expect(reconcileB.ok(), await reconcileB.text()).toBe(true);
    expect((await reconcileB.json()).reconciliation?.passed).toBe(true);

    const resetAAgain = await postSimulator(request, token, { action: "reset", namespace: namespaceA });
    expect(resetAAgain.ok(), await resetAAgain.text()).toBe(true);
    expect((await resetAAgain.json()).alreadyRemoved).toBe(true);
  } finally {
    await cleanup(namespaceA);
    await cleanup(namespaceB);
  }
});
