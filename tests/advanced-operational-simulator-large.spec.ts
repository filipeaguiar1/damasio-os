import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";

async function adminAccessToken() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.error || !login.data.session?.access_token) {
    throw new Error(login.error?.message || "Advanced scale E2E could not authenticate the Admin.");
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
    timeout: 45 * 60 * 1000,
  });
}

test("large advanced simulator reconciles 12-month / 4,620-service scenario", async ({ request }) => {
  test.setTimeout(55 * 60 * 1000);
  expect(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();
  expect(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();
  expect(ADMIN_EMAIL, "E2E_ADMIN_EMAIL is required").toBeTruthy();
  expect(ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD is required").toBeTruthy();

  const token = await adminAccessToken();
  const namespace = `scale-${Date.now().toString(36)}`;

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cleanup = async () => {
    const response = await postSimulator(request, token, { action: "reset", namespace });
    if (!response.ok()) {
      console.warn(`Scale cleanup: ${response.status()} ${await response.text()}`);
      return null;
    }
    return response.json();
  };

  await cleanup();
  let finalCleanup: any = null;
  try {
    const created = await postSimulator(request, token, {
      action: "create",
      namespace,
      scenario: "large_12_month",
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = await created.json();

    expect(body.operational?.customerCount).toBe(100);
    expect(body.operational?.workerCount).toBe(10);
    expect(body.operational?.completedVisits).toBe(4600);
    expect(body.operational?.scheduledVisits).toBe(20);
    expect(body.operational?.photoCount).toBe(4600);
    expect(body.operational?.invoiceCount).toBe(1200);
    expect(body.reconciliation?.expected?.serviceRecords).toBe(4620);
    expect(body.reconciliation?.visits?.passed).toBe(true);
    expect(body.reconciliation?.invoices?.passed).toBe(true);
    expect(body.reconciliation?.payments?.passed).toBe(true);
    expect(body.reconciliation?.payroll?.passed).toBe(true);
    expect(body.reconciliation?.km?.passed).toBe(true);
    expect(body.reconciliation?.evidence?.passed).toBe(true);
    expect(body.reconciliation?.passed).toBe(true);

    const reconcile = await postSimulator(request, token, {
      action: "reconcile",
      namespace,
      scenario: "large_12_month",
    });
    expect(reconcile.ok(), await reconcile.text()).toBe(true);
    const reconciled = await reconcile.json();
    expect(reconciled.reconciliation?.passed).toBe(true);
    expect(reconciled.reconciliation?.visits?.actualCompleted).toBe(4600);
    expect(reconciled.reconciliation?.visits?.actualScheduled).toBe(20);
  } finally {
    finalCleanup = await cleanup();
  }

  expect(finalCleanup?.routesRemoved).toBeGreaterThan(0);
  const residualEmployees = await service.from("employees").select("crew_id").like("email", `%${namespace}%`);
  expect(residualEmployees.error?.message || "").toBe("");
  const crewIds = [...new Set((residualEmployees.data || []).map((row: any) => String(row.crew_id || "")).filter(Boolean))];
  const residualRoutes = crewIds.length
    ? await service.from("routes").select("id", { count: "exact", head: true }).in("crew_id", crewIds)
    : { count: 0, error: null };
  expect(residualRoutes.error?.message || "").toBe("");
  expect(residualRoutes.count || 0).toBe(0);

  const resetAgain = await postSimulator(request, token, { action: "reset", namespace });
  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);
  const resetAgainBody = await resetAgain.json();
  expect(resetAgainBody.alreadyRemoved).toBe(true);
  expect(resetAgainBody.routesRemoved || 0).toBe(0);
});
