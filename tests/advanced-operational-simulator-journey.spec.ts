import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";

function torontoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function authClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

async function signIn(email: string, password: string) {
  const client = authClient();
  const login = await client.auth.signInWithPassword({ email, password });
  expect(login.error, login.error?.message).toBeNull();
  const token = login.data.session?.access_token || "";
  expect(token).toBeTruthy();
  return { client, token };
}

async function postSimulator(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
) {
  return request.post(`${APP_URL}/api/admin/operational-simulator/v2`, {
    headers: { authorization: `Bearer ${token}` },
    data: body,
    timeout: 20 * 60 * 1000,
  });
}

async function jsonOk(response: any, label: string) {
  const text = await response.text();
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : {};
}

test("advanced simulator proves Customer through Feedback, team Task and History", async ({ request }) => {
  test.setTimeout(30 * 60 * 1000);
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    E2E_ADMIN_EMAIL: ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
  })) expect(value, `${name} is required`).toBeTruthy();

  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const routeDate = torontoDateKey();
  const namespace = `journey-${Date.now().toString(36)}`;
  const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

  const cleanup = async () => {
    const response = await postSimulator(request, admin.token, { action: "reset", namespace });
    if (!response.ok()) console.warn(`Journey cleanup: ${response.status()} ${await response.text()}`);
  };

  await cleanup();
  try {
    const createdResponse = await postSimulator(request, admin.token, {
      action: "create",
      namespace,
      scenario: "baseline",
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = await createdResponse.json();

    expect(created.operational?.customerCount).toBe(60);
    expect(created.operational?.workerCount).toBe(2);
    expect(created.operational?.completedVisits).toBe(480);
    expect(created.operational?.scheduledVisits).toBe(8);
    expect(created.reconciliation?.passed).toBe(true);

    const featured = created.featuredCustomer as { email: string; password: string; name: string };
    const workerCredentials = created.workers?.[0] as { email: string; password: string; name: string };
    expect(featured?.email).toBeTruthy();
    expect(workerCredentials?.email).toBeTruthy();

    const customerRow = await service.from("customers")
      .select("id,profile_id,company_id,organization_id")
      .ilike("email", featured.email)
      .is("archived_at", null)
      .maybeSingle();
    expect(customerRow.error, customerRow.error?.message).toBeNull();
    const customerId = String(customerRow.data?.id || "");
    const companyId = String(customerRow.data?.company_id || customerRow.data?.organization_id || "");
    expect(customerId).toBeTruthy();
    expect(companyId).toBeTruthy();

    const property = await service.from("properties")
      .select("id")
      .eq("customer_id", customerId)
      .limit(1)
      .maybeSingle();
    expect(property.error, property.error?.message).toBeNull();
    const propertyId = String(property.data?.id || "");
    expect(propertyId).toBeTruthy();

    const quote = await service.from("quotes")
      .select("id,status")
      .eq("customer_id", customerId)
      .eq("property_id", propertyId)
      .limit(1)
      .maybeSingle();
    expect(quote.error, quote.error?.message).toBeNull();
    const quoteId = String(quote.data?.id || "");
    expect(quoteId).toBeTruthy();
    expect(quote.data?.status).toBe("approved");

    const job = await service.from("jobs")
      .select("id,active,quote_id")
      .eq("customer_id", customerId)
      .eq("property_id", propertyId)
      .limit(1)
      .maybeSingle();
    expect(job.error, job.error?.message).toBeNull();
    const jobId = String(job.data?.id || "");
    expect(jobId).toBeTruthy();
    expect(job.data?.active).toBe(true);
    expect(String(job.data?.quote_id || "")).toBe(quoteId);

    const scheduledVisit = await service.from("visits")
      .select("id,route_id,status,scheduled_date,assigned_employee_id,crew_id")
      .eq("customer_id", customerId)
      .eq("job_id", jobId)
      .eq("scheduled_date", routeDate)
      .eq("status", "scheduled")
      .limit(1)
      .maybeSingle();
    expect(scheduledVisit.error, scheduledVisit.error?.message).toBeNull();
    const visitId = String(scheduledVisit.data?.id || "");
    const routeId = String(scheduledVisit.data?.route_id || "");
    expect(visitId).toBeTruthy();
    expect(routeId).toBeTruthy();

    const routeStop = await service.from("route_stops")
      .select("route_id,visit_id,position")
      .eq("route_id", routeId)
      .eq("visit_id", visitId)
      .maybeSingle();
    expect(routeStop.error, routeStop.error?.message).toBeNull();
    expect(routeStop.data?.visit_id).toBe(visitId);

    const worker = await signIn(workerCredentials.email, workerCredentials.password);
    const bootstrap = await jsonOk(await request.post(`${APP_URL}/api/mobile/employee/bootstrap`, {
      headers: { authorization: `Bearer ${worker.token}` },
    }), "Employee bootstrap");
    const employeeId = String(bootstrap.employee?.id || "");
    expect(employeeId).toBeTruthy();

    const employeeRoute = await jsonOk(await request.get(`${APP_URL}/api/mobile/employee/route?date=${routeDate}`, {
      headers: { authorization: `Bearer ${worker.token}` },
    }), "Employee canonical route");
    expect(employeeRoute.stops?.some((stop: any) => stop.visitId === visitId && stop.status === "scheduled")).toBe(true);

    const started = await jsonOk(await request.patch(`${APP_URL}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${worker.token}` },
      data: { visitId, action: "start" },
    }), "Employee Start");
    expect(started.visit?.status).toBe("in_progress");
    expect(started.visit?.started_at).toBeTruthy();

    const done = await jsonOk(await request.patch(`${APP_URL}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${worker.token}` },
      data: { visitId, action: "done" },
    }), "Employee Done");
    expect(done.visit?.status).toBe("completed");
    expect(done.visit?.finished_at).toBeTruthy();
    expect(Number(done.visit?.duration_seconds)).toBeGreaterThanOrEqual(0);

    const customer = await signIn(featured.email, featured.password);
    await jsonOk(await request.post(`${APP_URL}/api/customer/portal-actions`, {
      headers: { authorization: `Bearer ${customer.token}` },
      data: {
        action: "feedback",
        visitId,
        rating: 2,
        comment: "Advanced simulation follow-up: side-gate edge needs another pass.",
      },
    }), "Customer Feedback");

    const feedback = await service.from("feedback")
      .select("id,rating,comment,visit_id,customer_id,property_id")
      .eq("visit_id", visitId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(feedback.error, feedback.error?.message).toBeNull();
    const feedbackId = String(feedback.data?.id || "");
    expect(feedbackId).toBeTruthy();
    expect(feedback.data?.rating).toBe(2);

    const task = await service.from("tasks")
      .select("id,status,priority,source_visit_id,customer_id,property_id")
      .eq("source_visit_id", visitId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(task.error, task.error?.message).toBeNull();
    const taskId = String(task.data?.id || "");
    expect(taskId).toBeTruthy();
    expect(task.data?.status).toBe("open");
    expect(task.data?.priority).toBe("urgent");

    const adminRequests = await jsonOk(await request.get(`${APP_URL}/api/admin/service-requests`, {
      headers: { authorization: `Bearer ${admin.token}` },
    }), "Admin feedback Task visibility");
    expect(adminRequests.requests?.some((row: any) => row.id === taskId && row.kind === "customer_task")).toBe(true);

    const assign = await admin.client.rpc("assign_task", {
      p_task_id: taskId,
      p_employee_id: employeeId,
      p_crew_id: null,
      p_scheduled_date: null,
    });
    expect(assign.error, assign.error?.message).toBeNull();

    const assignedTask = await service.from("tasks")
      .select("status,assigned_employee_id,assigned_at")
      .eq("id", taskId)
      .single();
    expect(assignedTask.error, assignedTask.error?.message).toBeNull();
    expect(assignedTask.data?.status).toBe("assigned");
    expect(String(assignedTask.data?.assigned_employee_id || "")).toBe(employeeId);

    const taskStarted = await worker.client.rpc("start_assigned_task", { p_task_id: taskId });
    expect(taskStarted.error, taskStarted.error?.message).toBeNull();
    const taskCompleted = await worker.client.rpc("complete_assigned_task", {
      p_task_id: taskId,
      p_summary: "Side-gate edge corrected by the assigned team Employee.",
    });
    expect(taskCompleted.error, taskCompleted.error?.message).toBeNull();

    const completedTask = await service.from("tasks")
      .select("status,work_started_at,work_finished_at,completed_by_profile_id,completion_duration_seconds,completion_summary")
      .eq("id", taskId)
      .single();
    expect(completedTask.error, completedTask.error?.message).toBeNull();
    expect(completedTask.data?.status).toBe("completed");
    expect(completedTask.data?.work_started_at).toBeTruthy();
    expect(completedTask.data?.work_finished_at).toBeTruthy();
    expect(Number(completedTask.data?.completion_duration_seconds)).toBeGreaterThanOrEqual(0);

    const resolve = await admin.client.rpc("resolve_completed_task", {
      p_task_id: taskId,
      p_summary: "Admin verified the team correction and closed the Customer follow-up.",
    });
    expect(resolve.error, resolve.error?.message).toBeNull();

    const resolvedTask = await service.from("tasks")
      .select("status,resolved_at,admin_resolved_at,completion_summary")
      .eq("id", taskId)
      .single();
    expect(resolvedTask.error, resolvedTask.error?.message).toBeNull();
    expect(resolvedTask.data?.status).toBe("resolved");
    expect(resolvedTask.data?.resolved_at).toBeTruthy();
    expect(resolvedTask.data?.admin_resolved_at).toBeTruthy();

    const taskEvents = await service.from("task_events")
      .select("event_type,task_id")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    expect(taskEvents.error, taskEvents.error?.message).toBeNull();
    const events = (taskEvents.data || []).map((row: any) => String(row.event_type));
    for (const expected of ["assigned", "started", "completed", "resolved"]) {
      expect(events, `Task event ${expected} must exist`).toContain(expected);
    }

    const history = await jsonOk(await request.get(`${APP_URL}/api/customer/portal-board`, {
      headers: { authorization: `Bearer ${customer.token}` },
    }), "Customer History");
    expect(history.board?.quotes?.some((row: any) => row.id === quoteId)).toBe(true);
    expect(history.board?.visits?.some((row: any) => row.id === visitId && row.status === "completed")).toBe(true);
    expect(history.board?.feedback?.some((row: any) => row.id === feedbackId && row.visitId === visitId)).toBe(true);
    expect(history.board?.tasks?.some((row: any) => row.id === taskId && row.status === "resolved")).toBe(true);

    console.log(JSON.stringify({
      checkpoint: "advanced-canonical-journey-complete",
      namespace,
      companyId,
      customerId,
      propertyId,
      quoteId,
      jobId,
      routeId,
      visitId,
      feedbackId,
      taskId,
      taskEvents: events,
      path: [
        "Customer", "Property", "Quote", "Job", "Schedule/Dispatch", "Employee Route",
        "Start", "Done", "Feedback", "Task Assigned", "Task Started", "Task Completed",
        "Task Resolved", "History",
      ],
    }));
  } finally {
    await cleanup();
  }

  const resetAgain = await postSimulator(request, admin.token, { action: "reset", namespace });
  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);
  expect((await resetAgain.json()).alreadyRemoved).toBe(true);
});
