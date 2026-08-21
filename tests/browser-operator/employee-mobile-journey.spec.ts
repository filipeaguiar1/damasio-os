import { expect, test } from "@playwright/test";
import {
  assertNoMutableResidue,
  attachQaVisitPhoto,
  browserAuthRequest,
  cleanupMutableOperatorFixture,
  createMutableOperatorFixture,
  requireOperatorEnvironment,
  serviceClient,
  signInAccount,
  signInBrowser,
  torontoDate,
  type OperatorFixture,
} from "./fixtures";

test("employee mobile Browser Operator starts, finishes, attaches photo fixture and receives Customer feedback", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const { namespace: baseNamespace } = requireOperatorEnvironment();
  const db = serviceClient();
  let fixture: OperatorFixture | null = null;

  try {
    fixture = await createMutableOperatorFixture(db, baseNamespace);
    const today = torontoDate();

    await signInBrowser(page, fixture.admin.email, fixture.admin.password);
    const published = await browserAuthRequest<any>(page, "/api/admin/route-advisor", {
      method: "POST",
      body: {
        action: "publish",
        employeeId: fixture.employee.employeeId,
        crewId: fixture.employee.crewId,
        routeDate: today,
        orderedJobIds: fixture.hamiltonJobIds.slice(0, 3),
        sourceVisitIds: [],
        origin: {
          label: "QA Browser Operator mobile start",
          latitude: 43.2557,
          longitude: -79.8711,
        },
      },
      timeoutMs: 180_000,
    });
    fixture.created.routeIds.push(String(published.routeId));
    fixture.created.visitIds.push(...(published.orderedVisitIds || []).map(String));

    await signInBrowser(page, fixture.employee.email, fixture.employee.password);
    await page.goto("/mobile/employee", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText(/application error|internal server error/i);
    await testInfo.attach("employee-mobile-route", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    const route = await browserAuthRequest<any>(page, `/api/mobile/employee/route?date=${encodeURIComponent(today)}`);
    expect(route.stops || []).toHaveLength(3);
    const visitId = String(route.stops[0]?.visitId || "");
    expect(visitId).toBeTruthy();

    const started = await browserAuthRequest<any>(page, "/api/mobile/employee/route", {
      method: "PATCH",
      body: { visitId, action: "start" },
    });
    expect(started.visit?.status).toBe("in_progress");
    expect(started.visit?.started_at).toBeTruthy();

    const finished = await browserAuthRequest<any>(page, "/api/mobile/employee/route", {
      method: "PATCH",
      body: { visitId, action: "done" },
    });
    expect(finished.visit?.status).toBe("completed");
    expect(finished.visit?.finished_at).toBeTruthy();

    const photoPath = await attachQaVisitPhoto(db, fixture, visitId);
    expect(photoPath).toContain(fixture.namespace);

    const customer = await signInAccount(fixture.customer.email, fixture.customer.password);
    const feedbackResponse = await page.request.fetch("/api/customer/portal-actions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${customer.token}`,
        "content-type": "application/json",
      },
      data: {
        action: "feedback",
        visitId,
        rating: 2,
        comment: `QA Browser Operator feedback ${fixture.namespace}`,
      },
      failOnStatusCode: false,
    });
    const feedbackBody = await feedbackResponse.json().catch(() => ({}));
    expect(feedbackResponse.ok(), JSON.stringify(feedbackBody)).toBe(true);
    expect(feedbackBody.saved).toBe(true);

    const [visit, photos, feedback, task] = await Promise.all([
      db.from("visits").select("id,status,started_at,finished_at,duration_seconds").eq("id", visitId).single(),
      db.from("photos").select("id,storage_path,photo_type").eq("visit_id", visitId),
      db.from("feedback").select("id,rating,comment").eq("visit_id", visitId).eq("customer_id", fixture.customer.customerId),
      db.from("tasks").select("id,status,priority,source_visit_id").eq("source_visit_id", visitId),
    ]);
    expect(visit.error, visit.error?.message).toBeNull();
    expect(visit.data.status).toBe("completed");
    expect(Number(visit.data.duration_seconds)).toBeGreaterThanOrEqual(0);
    expect(photos.error, photos.error?.message).toBeNull();
    expect((photos.data || []).some((row: any) => String(row.storage_path) === photoPath && row.photo_type === "completion")).toBe(true);
    expect(feedback.error, feedback.error?.message).toBeNull();
    expect((feedback.data || []).some((row: any) => Number(row.rating) === 2 && String(row.comment).includes(fixture!.namespace))).toBe(true);
    expect(task.error, task.error?.message).toBeNull();
    expect((task.data || []).some((row: any) => row.status === "open" && row.priority === "urgent")).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    const recovered = await browserAuthRequest<any>(page, `/api/mobile/employee/route?date=${encodeURIComponent(today)}`);
    expect(recovered.stops.some((stop: any) => stop.visitId === visitId && stop.status === "completed")).toBe(true);
  } finally {
    await cleanupMutableOperatorFixture(db, fixture);
    if (fixture) await assertNoMutableResidue(db, fixture);
  }
});
