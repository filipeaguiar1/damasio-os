from pathlib import Path

path = Path("app/api/admin/routes/route.ts")
text = path.read_text()
start = text.index("async function canonicalVisits(service: any, companyId: string, routeDate?: string | null) {")
end = text.index("\nfunction canonicalHealth", start)
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

  const routes = routesResult.data || [];
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

  const stopRows = stopResults.flatMap(result => result.data || []);
  const visitIds = [...new Set(stopRows.map((row: any) => String(row.visit_id)).filter(Boolean))];
  if (!visitIds.length) return [] as any[];

  const visitResults = await Promise.all(batches(visitIds).map(ids => service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,started_at,finished_at,duration_seconds,created_at,customers(full_name,email,notes),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")
    .in("id", ids)
    .or(companyFilter(companyId))
    .neq("status", "cancelled")));
  for (const result of visitResults) if (result.error) throw new Error(result.error.message);

  const visits = new Map<string, any>();
  for (const result of visitResults) {
    for (const row of result.data || []) visits.set(String(row.id), row);
  }
  const routeById = new Map(routes.map((route: any) => [String(route.id), route]));

  const canonical = stopRows.map((stop: any) => {
    const row = visits.get(String(stop.visit_id));
    if (!row) {
      throw new Error(`route_stops references missing or cancelled Visit ${stop.visit_id}.`);
    }
    if (String(row.route_id || "") !== String(stop.route_id)) {
      throw new Error(`Visit ${stop.visit_id} does not belong to its canonical route_stops Route.`);
    }

    const employee = (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null;
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const route = routeById.get(String(stop.route_id));

    // Demo identities are not operational Employees. Customer archived flags are
    // deliberately ignored here: route_stops is the authoritative published Route.
    if (isDemoLabel(employee)) return null;

    return {
      id: row.id,
      jobId: row.job_id,
      routeId: String(stop.route_id),
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
    };
  }).filter(Boolean);

  const byRoute = new Map<string, any[]>();
  for (const visit of canonical) {
    const rows = byRoute.get(visit.routeId) || [];
    rows.push(visit);
    byRoute.set(visit.routeId, rows);
  }
  for (const [id, rows] of byRoute) {
    rows.sort((left, right) => left.routeOrder - right.routeOrder);
    const valid = rows.every((row, index) => row.routeOrder === index + 1);
    if (!valid) throw new Error(`Canonical route_stops positions are invalid for Route ${id}.`);
  }

  return canonical.sort((left, right) =>
    String(right.scheduledDate || "").localeCompare(String(left.scheduledDate || ""))
    || String(left.routeId).localeCompare(String(right.routeId))
    || left.routeOrder - right.routeOrder);
}
'''
path.write_text(text[:start] + replacement + text[end:])
