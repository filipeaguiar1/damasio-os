from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


robust_sign_in = '''async function signIn(page: Page, email: string, password: string) {
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
}'''

simple_sign_in = '''async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}'''

for test_file in ["tests/operational-simulator.spec.ts", "tests/canonical-route-sync.spec.ts"]:
    replace_once(test_file, simple_sign_in, robust_sign_in)

route_file = Path("app/api/admin/routes/route.ts")
route_text = route_file.read_text()
start = route_text.index("async function canonicalVisits(service: any, companyId: string, routeDate?: string | null) {")
end = route_text.index("\nfunction canonicalHealth", start)
replacement = r'''async function canonicalVisits(service: any, companyId: string, routeDate?: string | null) {
  let routeQuery = service
    .from("routes")
    .select("id,crew_id,route_date,created_at")
    .or(companyFilter(companyId));

  if (routeDate) routeQuery = routeQuery.eq("route_date", routeDate);

  const routesResult = await routeQuery
    .order("route_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(routeDate ? 250 : 500);
  if (routesResult.error) throw new Error(routesResult.error.message);

  const routes: any[] = routesResult.data || [];
  const routeIds = routes.map((route: any) => String(route.id));
  if (!routeIds.length) return [] as any[];

  const batches = <T,>(values: T[], size = 40) => {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  };

  const stopResults = await Promise.all(batches(routeIds).map(ids => service
    .from("route_stops")
    .select("route_id,visit_id,position")
    .in("route_id", ids)
    .order("position", { ascending: true })));
  for (const result of stopResults) if (result.error) throw new Error(result.error.message);

  const stopRows: any[] = stopResults.flatMap(result => result.data || []);
  const visitIds = [...new Set(stopRows.map((row: any) => String(row.visit_id)).filter(Boolean))];
  if (!visitIds.length) return [] as any[];

  const visitResults = await Promise.all(batches(visitIds).map(ids => service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,started_at,finished_at,duration_seconds,created_at,customers(full_name,email,notes,archived_at),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")
    .in("id", ids)
    .or(companyFilter(companyId))));
  for (const result of visitResults) if (result.error) throw new Error(result.error.message);

  const visits = new Map<string, any>();
  for (const result of visitResults) {
    for (const row of result.data || []) visits.set(String(row.id), row);
  }
  const routeById = new Map<string, any>(routes.map((route: any) => [String(route.id), route]));
  const candidatesByRoute = new Map<string, any[]>();

  for (const stop of stopRows) {
    const routeId = String(stop.route_id);
    const row = visits.get(String(stop.visit_id)) || null;
    const employee = row
      ? (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null
      : null;
    const customer = row ? (Array.isArray(row.customers) ? row.customers[0] : row.customers) : null;
    const property = row ? (Array.isArray(row.properties) ? row.properties[0] : row.properties) : null;
    const route: any = routeById.get(routeId);
    const candidate = {
      routeId,
      position: Number(stop.position),
      missingVisit: !row,
      cancelled: row?.status === "cancelled",
      archived: Boolean(customer?.archived_at),
      demo: isDemoLabel(employee),
      visit: row ? {
        id: row.id,
        jobId: row.job_id,
        routeId,
        crewId: row.crew_id || route?.crew_id || null,
        crewName: employee,
        employeeId: row.assigned_employee_id,
        employeeName: employee,
        customerId: row.customer_id,
        customerName: customer?.full_name || null,
        propertyId: row.property_id,
        address: [
          property?.address_line1,
          property?.city,
          property?.province,
          property?.postal_code,
        ].filter(Boolean).join(", "),
        serviceName: (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs)?.service_name || "Property Service",
        scheduledDate: row.scheduled_date || route?.route_date || null,
        status: row.status,
        routeOrder: Number(stop.position),
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
      } : null,
    };
    const current = candidatesByRoute.get(routeId) || [];
    current.push(candidate);
    candidatesByRoute.set(routeId, current);
  }

  const canonical: any[] = [];
  for (const [id, candidates] of candidatesByRoute) {
    candidates.sort((left, right) => left.position - right.position);
    const positionsValid = candidates.every((candidate, index) => candidate.position === index + 1);
    const hasBrokenVisit = candidates.some(candidate => candidate.missingVisit || candidate.cancelled);
    const allArchived = candidates.length > 0 && candidates.every(candidate => candidate.archived);
    const allDemo = candidates.length > 0 && candidates.every(candidate => candidate.demo);
    const mixedRetired = candidates.some(candidate => candidate.archived || candidate.demo);

    if (allArchived || allDemo) continue;

    if (!positionsValid || hasBrokenVisit || mixedRetired) {
      const reason = !positionsValid
        ? "positions are not sequential"
        : hasBrokenVisit
          ? "a route_stop references a missing or cancelled Visit"
          : "active and retired identities are mixed";
      if (routeDate) throw new Error(`Canonical Route ${id} is invalid: ${reason}.`);
      console.warn("admin-routes-skip-stale-route", { routeId: id, reason });
      continue;
    }

    canonical.push(...candidates.map(candidate => candidate.visit));
  }

  return canonical.sort((left, right) =>
    String(right.scheduledDate || "").localeCompare(String(left.scheduledDate || ""))
    || String(left.routeId).localeCompare(String(right.routeId))
    || left.routeOrder - right.routeOrder);
}
'''
route_file.write_text(route_text[:start] + replacement + route_text[end:])

workflow = Path(".github/workflows/final-canonical-release-gate.yml")
if workflow.exists():
    workflow_text = workflow.read_text()
    workflow_text = workflow_text.replace(
        "      - name: Four-screen canonical Route\n        run: pnpm exec playwright test tests/canonical-route-sync.spec.ts --reporter=line --workers=1",
        "      - name: Four-screen canonical Route\n        if: always()\n        run: pnpm exec playwright test tests/canonical-route-sync.spec.ts --reporter=line --workers=1",
    )
    workflow.write_text(workflow_text)
