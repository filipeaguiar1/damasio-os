type ServiceClient = any;

type CanonicalEmployee = {
  id: string;
  crew_id: string | null;
  full_name: string | null;
  email: string | null;
  active: boolean;
};

type VisitSnapshot = {
  id: string;
  job_id: string | null;
  route_id: string | null;
  crew_id: string | null;
  assigned_employee_id: string | null;
  scheduled_date: string;
  status: string;
  route_order: number | null;
  customer_id?: string | null;
  property_id?: string | null;
  created_at?: string | null;
};

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

export function isDemoRouteIdentity(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return /^demo(?:[\s._+-]*\d+)?$/.test(normalized)
    || /^demo(?:[._+-]?\d*)?@/.test(normalized)
    || normalized.endsWith("@example.com");
}

export async function requireCanonicalRouteEmployee(input: {
  service: ServiceClient;
  companyId: string;
  employeeId: string;
  crewId: string;
}) {
  const { service, companyId, employeeId, crewId } = input;
  const result = await service
    .from("employees")
    .select("id,crew_id,full_name,email,active")
    .eq("id", employeeId)
    .eq("active", true)
    .or(companyFilter(companyId))
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  const employee = result.data as CanonicalEmployee | null;
  if (!employee) {
    throw new Error("The selected canonical Employee was not found in this company.");
  }
  if (!employee.crew_id || employee.crew_id !== crewId) {
    throw new Error("The selected Employee and Crew IDs do not match.");
  }
  if (isDemoRouteIdentity(employee.full_name) || isDemoRouteIdentity(employee.email)) {
    throw new Error("Demo users cannot receive operational routes.");
  }
  return employee;
}

async function loadPublishedRoute(input: {
  service: ServiceClient;
  companyId: string;
  crewId: string;
  routeDate: string;
  preferredRouteId?: string | null;
}) {
  const { service, companyId, crewId, routeDate, preferredRouteId } = input;
  let query = service
    .from("routes")
    .select("id,crew_id,route_date,status")
    .eq("crew_id", crewId)
    .eq("route_date", routeDate)
    .or(companyFilter(companyId));

  if (preferredRouteId) query = query.eq("id", preferredRouteId);
  const result = await query.limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.id) {
    throw new Error("The canonical Route was not created by the database transaction.");
  }
  return result.data;
}

export async function enforcePublishedRouteEmployee(input: {
  service: ServiceClient;
  companyId: string;
  employeeId: string;
  crewId: string;
  routeDate: string;
  orderedJobIds: string[];
  preferredRouteId?: string | null;
}) {
  const { service, companyId, employeeId, crewId, routeDate } = input;
  const orderedJobIds = [...new Set(input.orderedJobIds.map(String).filter(Boolean))];
  if (!orderedJobIds.length) {
    throw new Error("The reviewed route contains no canonical Jobs.");
  }

  const employee = await requireCanonicalRouteEmployee({
    service,
    companyId,
    employeeId,
    crewId,
  });
  const route = await loadPublishedRoute({
    service,
    companyId,
    crewId,
    routeDate,
    preferredRouteId: input.preferredRouteId,
  });
  const routeId = String(route.id);

  const visitsResult = await service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order,customer_id,property_id,created_at")
    .eq("route_id", routeId)
    .neq("status", "cancelled")
    .or(companyFilter(companyId))
    .order("route_order", { ascending: true, nullsFirst: false });
  if (visitsResult.error) throw new Error(visitsResult.error.message);

  const visits = (visitsResult.data || []) as VisitSnapshot[];
  const validVisits = visits.length === orderedJobIds.length
    && orderedJobIds.every((jobId, index) => {
      const visit = visits[index];
      return visit?.job_id === jobId
        && visit.route_id === routeId
        && visit.assigned_employee_id === employee.id
        && visit.crew_id === crewId
        && visit.scheduled_date === routeDate
        && visit.route_order === index + 1
        && Boolean(visit.customer_id)
        && Boolean(visit.property_id);
    });

  if (!validVisits) {
    throw new Error("The published route does not exactly match the reviewed Employee, houses and order.");
  }

  const stopsResult = await service
    .from("route_stops")
    .select("route_id,visit_id,position")
    .eq("route_id", routeId)
    .order("position", { ascending: true });
  if (stopsResult.error) {
    throw new Error(`Canonical Route Stops verification failed: ${stopsResult.error.message}`);
  }
  const stops = stopsResult.data || [];
  const validStops = stops.length === visits.length
    && stops.every((stop: any, index: number) =>
      stop.route_id === routeId
      && stop.visit_id === visits[index].id
      && stop.position === index + 1);
  if (!validStops) {
    throw new Error("Route Stops and the Visit projection are not synchronized.");
  }

  const stateResult = await service
    .from("route_order_state")
    .select("version,last_source,updated_at")
    .eq("route_id", routeId)
    .maybeSingle();
  if (stateResult.error || !stateResult.data?.version) {
    throw new Error(stateResult.error?.message || "The Route version was not created.");
  }

  return {
    routeId,
    employeeId: employee.id,
    employeeName: employee.full_name || "Employee",
    count: visits.length,
    visits,
    routeVersion: Number(stateResult.data.version),
    canonicalSource: "route_stops_v2",
    assignmentVerified: true,
  };
}

export async function enforceMovedVisitEmployee(input: {
  service: ServiceClient;
  companyId: string;
  employeeId: string;
  crewId: string;
  visitIds: string[];
}) {
  const { service, companyId, employeeId, crewId } = input;
  const visitIds = [...new Set(input.visitIds.map(String).filter(Boolean))];
  const employee = await requireCanonicalRouteEmployee({
    service,
    companyId,
    employeeId,
    crewId,
  });
  if (!visitIds.length) {
    throw new Error("No canonical Visits were selected for movement.");
  }

  const visitsResult = await service
    .from("visits")
    .select("id,route_id,crew_id,assigned_employee_id,status,route_order")
    .in("id", visitIds)
    .or(companyFilter(companyId));
  if (visitsResult.error) throw new Error(visitsResult.error.message);
  const visits = visitsResult.data || [];

  if (visits.length !== visitIds.length
      || visits.some((visit: any) =>
        !visit.route_id
        || visit.assigned_employee_id !== employee.id
        || visit.crew_id !== crewId
        || visit.status !== "scheduled"
        || !Number.isInteger(visit.route_order))) {
    throw new Error("The moved houses failed final Employee and Route verification.");
  }

  const stopsResult = await service
    .from("route_stops")
    .select("route_id,visit_id,position")
    .in("visit_id", visitIds);
  if (stopsResult.error) {
    throw new Error(`Canonical Route Stops verification failed: ${stopsResult.error.message}`);
  }
  const stops = stopsResult.data || [];
  const stopByVisit = new Map(stops.map((stop: any) => [String(stop.visit_id), stop]));
  const validStops = stops.length === visitIds.length
    && visits.every((visit: any) => {
      const stop = stopByVisit.get(String(visit.id)) as any;
      return stop
        && stop.route_id === visit.route_id
        && stop.position === visit.route_order;
    });
  if (!validStops) {
    throw new Error("Moved Visits and Route Stops are not synchronized.");
  }

  return {
    employeeId: employee.id,
    employeeName: employee.full_name || "Employee",
    movedCount: visitIds.length,
    canonicalSource: "route_stops_v2",
    assignmentVerified: true,
  };
}

// Legacy demo data must be repaired through Admin publication, never through a
// GET request. This function now detects corruption without mutating a route.
export async function repairLegacyDemoAssignments(input: {
  service: ServiceClient;
  companyId: string;
  employee: { id: string; crew_id: string | null };
  visits: VisitSnapshot[];
}) {
  const { service, companyId, employee, visits } = input;
  if (!employee.crew_id) return [] as string[];

  const candidates = visits.filter(visit =>
    visit.crew_id === employee.crew_id
    && Boolean(visit.assigned_employee_id)
    && visit.assigned_employee_id !== employee.id
    && ["scheduled", "missed"].includes(String(visit.status)));
  const foreignIds = [...new Set(
    candidates.map(visit => visit.assigned_employee_id).filter(Boolean),
  )] as string[];
  if (!foreignIds.length) return [] as string[];

  const employeeRows = await service
    .from("employees")
    .select("id,full_name,email,active")
    .in("id", foreignIds)
    .or(companyFilter(companyId));
  if (employeeRows.error) throw new Error(employeeRows.error.message);

  const demoIds = new Set((employeeRows.data || [])
    .filter((row: any) =>
      isDemoRouteIdentity(row.full_name) || isDemoRouteIdentity(row.email))
    .map((row: any) => String(row.id)));
  const corruptedIds = candidates
    .filter(visit => visit.assigned_employee_id && demoIds.has(visit.assigned_employee_id))
    .map(visit => visit.id);

  if (corruptedIds.length) {
    throw new Error(
      "This route still contains legacy Demo assignments. Re-publish it from Admin before field work.",
    );
  }

  return [] as string[];
}
