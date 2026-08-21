import { expect, test } from "@playwright/test";
import {
  assertCanonicalRouteOrder,
  assertNoMutableResidue,
  browserAuthRequest,
  cleanupMutableOperatorFixture,
  createMutableOperatorFixture,
  requireOperatorEnvironment,
  serviceClient,
  signInAccount,
  signInBrowser,
  type OperatorFixture,
} from "./fixtures";

test("admin Browser Operator creates namespaced data and mutates canonical routes safely", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const { namespace: baseNamespace } = requireOperatorEnvironment();
  const db = serviceClient();
  let fixture: OperatorFixture | null = null;

  try {
    fixture = await createMutableOperatorFixture(db, baseNamespace);
    await signInBrowser(page, fixture.admin.email, fixture.admin.password);

    for (const target of [
      { name: "schedule", path: "/admin/schedule" },
      { name: "routes", path: "/admin/routes" },
      { name: "route-view", path: "/admin/routes?tab=view" },
      { name: "route-advisor", path: "/admin/routes?tab=advisor" },
    ]) {
      await test.step(`open ${target.name}`, async () => {
        const response = await page.goto(target.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
        expect(response?.status(), `${target.path} returned a server error`).toBeLessThan(500);
        await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
        await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
        await testInfo.attach(`admin-${target.name}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      });
    }

    const hamiltonPublish = await publishRoute(page, fixture, fixture.routeDate, fixture.hamiltonJobIds);
    fixture.created.routeIds.push(hamiltonPublish.routeId);
    fixture.created.visitIds.push(...hamiltonPublish.orderedVisitIds);
    await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 16);
    await assertNoDatedMembership(db, fixture.hamiltonJobIds[0], fixture.staleSundayDate, "stale Sunday recurrence");
    await assertNoDatedMembership(db, fixture.hamiltonJobIds[1], fixture.oldPublishedDate, "published-week replacement");

    const hamiltonSnapshot = await browserAuthRequest<any>(page, `/api/map/canonical-route?routeId=${encodeURIComponent(hamiltonPublish.routeId)}`);
    expect(hamiltonSnapshot.stops).toHaveLength(16);
    expect(hamiltonSnapshot.stops.every((stop: any) => /Hamilton/i.test(String(stop.address)))).toBe(true);

    const burlingtonPublish = await publishRoute(page, fixture, fixture.secondRouteDate, fixture.burlingtonJobIds);
    fixture.created.routeIds.push(burlingtonPublish.routeId);
    fixture.created.visitIds.push(...burlingtonPublish.orderedVisitIds);
    await assertCanonicalRouteOrder(db, burlingtonPublish.routeId, 8);

    const burlingtonSnapshot = await browserAuthRequest<any>(page, `/api/map/canonical-route?routeId=${encodeURIComponent(burlingtonPublish.routeId)}`);
    expect(burlingtonSnapshot.stops).toHaveLength(8);
    expect(burlingtonSnapshot.stops.every((stop: any) => /Burlington/i.test(String(stop.address)))).toBe(true);

    const movedJobId = fixture.hamiltonJobIds[2];
    const movePublish = await publishRoute(page, fixture, fixture.secondRouteDate, [...fixture.burlingtonJobIds, movedJobId], {
      removeFrom: {
        employeeId: fixture.employee.employeeId,
        crewId: fixture.employee.crewId,
        routeDate: fixture.routeDate,
        jobIds: [movedJobId],
      },
    });
    fixture.created.routeIds.push(movePublish.routeId);
    fixture.created.visitIds.push(...movePublish.orderedVisitIds);
    await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 15);
    await assertCanonicalRouteOrder(db, movePublish.routeId, 9);

    const movedSnapshot = await browserAuthRequest<any>(page, `/api/map/canonical-route?routeId=${encodeURIComponent(movePublish.routeId)}`);
    expect(movedSnapshot.stops.slice(0, 8).every((stop: any) => /Burlington/i.test(String(stop.address)))).toBe(true);
    expect(String(movedSnapshot.stops.at(-1)?.address || "")).toMatch(/Hamilton/i);

    const afterMoveOrder = await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 15);
    const removeVisitId = afterMoveOrder.at(-1) || "";
    const removeResult = await browserAuthRequest<any>(page, "/api/admin/route-advisor", {
      method: "POST",
      body: {
        action: "remove_today",
        visitIds: [removeVisitId],
        removalReason: "QA Browser Operator remove-from-day",
      },
    });
    expect(removeResult.removed).toBe(true);
    await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 14);
    await expectVisitOffRoute(db, removeVisitId, "remove-from-day");

    const cancelOrder = await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 14);
    const cancelVisitId = cancelOrder.at(-1) || "";
    const admin = await signInAccount(fixture.admin.email, fixture.admin.password);
    const cancelled = await admin.client.rpc("cancel_scheduled_visit", {
      p_visit_id: cancelVisitId,
      p_reason: "QA Browser Operator cancel/reload validation",
    });
    expect(cancelled.error, cancelled.error?.message).toBeNull();
    await assertCanonicalRouteOrder(db, hamiltonPublish.routeId, 13);
    await expectVisitCancelled(db, cancelVisitId);

    await page.goto(`/admin/routes?tab=view`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);

    const reloaded = await browserAuthRequest<any>(page, `/api/map/canonical-route?routeId=${encodeURIComponent(hamiltonPublish.routeId)}`);
    expect(reloaded.orderedVisitIds).toHaveLength(13);
    expect(reloaded.routeOrder.every((row: any, index: number) => Number(row.routeOrder) === index + 1)).toBe(true);
  } finally {
    await cleanupMutableOperatorFixture(db, fixture);
    if (fixture) await assertNoMutableResidue(db, fixture);
  }
});

async function publishRoute(
  page: any,
  fixture: OperatorFixture,
  routeDate: string,
  orderedJobIds: string[],
  extra: Record<string, unknown> = {},
) {
  const result = await browserAuthRequest<any>(page, "/api/admin/route-advisor", {
    method: "POST",
    body: {
      action: "publish",
      employeeId: fixture.employee.employeeId,
      crewId: fixture.employee.crewId,
      routeDate,
      orderedJobIds,
      sourceVisitIds: [],
      origin: {
        label: "QA Browser Operator Hamilton start",
        latitude: 43.2557,
        longitude: -79.8711,
      },
      ...extra,
    },
    timeoutMs: 180_000,
  });
  expect(result.routeId).toBeTruthy();
  expect(result.canonicalVerified).toBe(true);
  expect(result.orderedVisitIds).toHaveLength(orderedJobIds.length);
  return {
    routeId: String(result.routeId),
    orderedVisitIds: result.orderedVisitIds.map(String),
    routeVersion: Number(result.routeVersion),
  };
}

async function assertNoDatedMembership(db: any, jobId: string, date: string, label: string) {
  const result = await db.from("visits")
    .select("id,route_id,status,scheduled_date")
    .eq("job_id", jobId)
    .eq("scheduled_date", date)
    .neq("status", "cancelled")
    .not("route_id", "is", null);
  expect(result.error, result.error?.message).toBeNull();
  expect(result.data || [], `${label} must not survive as old route membership`).toHaveLength(0);
}

async function expectVisitOffRoute(db: any, visitId: string, label: string) {
  const visit = await db.from("visits").select("id,route_id,route_order,status").eq("id", visitId).single();
  expect(visit.error, visit.error?.message).toBeNull();
  expect(visit.data.route_id, `${label} must clear route_id`).toBeNull();
  expect(visit.data.route_order, `${label} must clear route_order`).toBeNull();
  const stop = await db.from("route_stops").select("visit_id").eq("visit_id", visitId);
  expect(stop.error, stop.error?.message).toBeNull();
  expect(stop.data || [], `${label} must remove route_stops membership`).toHaveLength(0);
}

async function expectVisitCancelled(db: any, visitId: string) {
  const visit = await db.from("visits").select("id,status,route_id,route_order").eq("id", visitId).single();
  expect(visit.error, visit.error?.message).toBeNull();
  expect(visit.data.status).toBe("cancelled");
  expect(visit.data.route_order).toBeNull();
  const stop = await db.from("route_stops").select("visit_id").eq("visit_id", visitId);
  expect(stop.error, stop.error?.message).toBeNull();
  expect(stop.data || [], "cancelled Visit must leave route_stops").toHaveLength(0);
}
