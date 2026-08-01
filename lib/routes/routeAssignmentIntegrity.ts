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
  if (!employee) throw new Error("The selected canonical Employee was not found in this company.");
  if (!employee.crew_id || employee.crew_id !== crewId) {
    throw new Error("The selected Employee and Crew IDs do not match.");
  }
  if (isDemoRouteIdentity(employee.full_name) || isDemoRouteIdentity(employee.email)) {
    throw new Error("Demo users cannot receive operational routes.");
  }
  return employee;
}

async function findOrCreateRoute(input: {
  service: ServiceClient;
  companyId: string;
  crewId: string;
  routeDate: string;
  preferredRouteId?: string | null;
}) {
  const { service, companyId, crewId, routeDate, preferredRouteId } = input;
  if (preferredRouteId) {
    const preferred = await service
      .from("routes")
      .select("id,crew_id,route_date")
      .eq("id", preferredRouteId)
      .or(companyFilter(companyId))
      .maybeSingle();
    if (preferred.error) throw new Error(preferred.error.message);
    if (preferred.data?.crew_id === crewId && preferred.data?.route_date === routeDate) {
      return String(preferred.data.id);
    }
  }

  const existing = await service
    .from("routes")
    .select("id")
    .eq("crew_id", crewId)
    .eq("route_date", routeDate)
    .or(companyFilter(companyId))
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return String(existing.data.id);

  const created = await service
    .from("routes")
    .insert({
      organization_id: companyId,
      company_id: companyId,
      crew_id: crewId,
      route_date: routeDate,
      status: "published",
    })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  return String(created.data.id);
}

async function restoreSnapshots(service: ServiceClient, snapshots: VisitSnapshot[], createdIds: string[]) {
  for (const id of createdIds.reverse()) {
    await service.from("visits").delete().eq("id", id);
  }
  for (const snapshot of snapshots.reverse()) {
    await service
      .from("visits")
      .update({
        route_id: snapshot.route_id,
        crew_id: snapshot.crew_id,
        assigned_employee_id: snapshot.assigned_employee_id,
        scheduled_date: snapshot.scheduled_date,
        status: snapshot.status,
        route_order: snapshot.route_order,
      })
      .eq("id", snapshot.id);
  }
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
  if (!orderedJobIds.length) throw new Error("The reviewed route contains no canonical Jobs.");

  const employee = await requireCanonicalRouteEmployee({ service, companyId, employeeId, crewId });
  const routeId = await findOrCreateRoute({
    service,
    companyId,
    crewId,
    routeDate,
    preferredRouteId: input.preferredRouteId,
  });

  const visitResult = await service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order,customer_id,property_id,created_at")
    .eq("scheduled_date", routeDate)
    .in("job_id", orderedJobIds)
    .neq("status", "cancelled")
    .or(companyFilter(companyId));
  if (visitResult.error) throw new Error(visitResult.error.message);

  const rows = (visitResult.data || []) as VisitSnapshot[];
  const byJob = new Map<string, VisitSnapshot[]>();
  for (const row of rows) {
    if (!row.job_id) continue;
    byJob.set(row.job_id, [...(byJob.get(row.job_id) || []), row]);
  }

  const missingJobIds = orderedJobIds.filter(jobId => !(byJob.get(jobId)?.length));
  if (missingJobIds.length) {
    const jobs = await service
      .from("jobs")
      .select("id,customer_id,property_id,active")
      .in("id", missingJobIds)
      .eq("active", true)
      .or(companyFilter(companyId));
    if (jobs.error) throw new Error(jobs.error.message);
    const jobMap = new Map((jobs.data || []).map((job: any) => [String(job.id), job]));
    for (const jobId of missingJobIds) {
      const job = jobMap.get(jobId) as any;
      if (!job?.customer_id || !job?.property_id) {
        throw new Error(`House ${jobId} is missing a canonical Customer or Property and was not published.`);
      }
    }
  }

  for (const jobId of orderedJobIds) {
    const matches = byJob.get(jobId) || [];
    if (matches.length > 1) {
      throw new Error(`House ${jobId} has duplicate Visits on ${routeDate}; the route was not accepted.`);
    }
  }

  const previous: VisitSnapshot[] = [];
  const createdIds: string[] = [];
  const saved: VisitSnapshot[] = [];

  try {
    for (let index = 0; index < orderedJobIds.length; index += 1) {
      const jobId = orderedJobIds[index];
      const existing = (byJob.get(jobId) || [])[0];
      const expectedOrder = index + 1;

      if (existing) {
        if (["in_progress", "completed"].includes(String(existing.status))
          && (existing.assigned_employee_id !== employee.id
            || existing.crew_id !== crewId
            || existing.route_id !== routeId
            || existing.route_order !== expectedOrder)) {
          throw new Error(`House ${jobId} is active or completed under another worker and cannot be reassigned automatically.`);
        }

        previous.push({ ...existing });
        const updated = await service
          .from("visits")
          .update({
            route_id: routeId,
            crew_id: crewId,
            assigned_employee_id: employee.id,
            scheduled_date: routeDate,
            status: ["scheduled", "missed"].includes(String(existing.status)) ? "scheduled" : existing.status,
            route_order: expectedOrder,
          })
          .eq("id", existing.id)
          .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order,customer_id,property_id,created_at")
          .single();
        if (updated.error) throw new Error(updated.error.message);
        saved.push(updated.data as VisitSnapshot);
        continue;
      }

      const job = await service
        .from("jobs")
        .select("id,customer_id,property_id")
        .eq("id", jobId)
        .or(companyFilter(companyId))
        .single();
      if (job.error || !job.data?.customer_id || !job.data?.property_id) {
        throw new Error(job.error?.message || `House ${jobId} could not be converted into a canonical Visit.`);
      }

      const inserted = await service
        .from("visits")
        .insert({
          organization_id: companyId,
          company_id: companyId,
          job_id: jobId,
          route_id: routeId,
          customer_id: job.data.customer_id,
          property_id: job.data.property_id,
          crew_id: crewId,
          assigned_employee_id: employee.id,
          scheduled_date: routeDate,
          status: "scheduled",
          route_order: expectedOrder,
        })
        .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order,customer_id,property_id,created_at")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      createdIds.push(String(inserted.data.id));
      saved.push(inserted.data as VisitSnapshot);
    }

    const verified = await service
      .from("visits")
      .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order")
      .eq("scheduled_date", routeDate)
      .in("job_id", orderedJobIds)
      .neq("status", "cancelled")
      .or(companyFilter(companyId));
    if (verified.error) throw new Error(verified.error.message);

    const verifiedRows = verified.data || [];
    const valid = verifiedRows.length === orderedJobIds.length
      && orderedJobIds.every((jobId, index) => {
        const matches = verifiedRows.filter((row: any) => String(row.job_id) === jobId);
        return matches.length === 1
          && matches[0].assigned_employee_id === employee.id
          && matches[0].crew_id === crewId
          && matches[0].route_id === routeId
          && matches[0].route_order === index + 1;
      });
    if (!valid) throw new Error("The route failed its final worker-assignment verification and was rolled back.");
  } catch (error) {
    await restoreSnapshots(service, previous, createdIds);
    throw error;
  }

  return {
    routeId,
    employeeId: employee.id,
    employeeName: employee.full_name || "Employee",
    count: saved.length,
    visits: saved,
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
  const employee = await requireCanonicalRouteEmployee({ service, companyId, employeeId, crewId });
  if (!visitIds.length) throw new Error("No canonical Visits were selected for movement.");

  const result = await service
    .from("visits")
    .select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order,created_at")
    .in("id", visitIds)
    .or(companyFilter(companyId));
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data || []) as VisitSnapshot[];
  if (rows.length !== visitIds.length) throw new Error("One or more moved Visits are missing from this company.");
  if (rows.some(row => row.status !== "scheduled")) {
    throw new Error("Only Scheduled Visits can be moved to another worker.");
  }

  const previous = rows.map(row => ({ ...row }));
  try {
    const dates = [...new Set(rows.map(row => row.scheduled_date))];
    for (const date of dates) {
      const routeId = await findOrCreateRoute({ service, companyId, crewId, routeDate: date });
      const dateRows = rows
        .filter(row => row.scheduled_date === date)
        .sort((left, right) => (left.route_order ?? 9999) - (right.route_order ?? 9999));
      const other = await service
        .from("visits")
        .select("route_order")
        .eq("route_id", routeId)
        .neq("status", "cancelled")
        .not("id", "in", `(${dateRows.map(row => row.id).join(",")})`)
        .order("route_order", { ascending: false, nullsFirst: false })
        .limit(1);
      if (other.error) throw new Error(other.error.message);
      let order = Number(other.data?.[0]?.route_order || 0);

      for (const row of dateRows) {
        order += 1;
        const updated = await service
          .from("visits")
          .update({
            route_id: routeId,
            crew_id: crewId,
            assigned_employee_id: employee.id,
            route_order: order,
          })
          .eq("id", row.id)
          .eq("status", "scheduled")
          .select("id")
          .maybeSingle();
        if (updated.error || !updated.data) {
          throw new Error(updated.error?.message || `Visit ${row.id} changed while it was being moved.`);
        }
      }
    }

    const verified = await service
      .from("visits")
      .select("id,assigned_employee_id,crew_id")
      .in("id", visitIds)
      .or(companyFilter(companyId));
    if (verified.error) throw new Error(verified.error.message);
    if ((verified.data || []).length !== visitIds.length
      || (verified.data || []).some((row: any) => row.assigned_employee_id !== employee.id || row.crew_id !== crewId)) {
      throw new Error("The moved houses failed final Employee verification.");
    }
  } catch (error) {
    await restoreSnapshots(service, previous, []);
    throw error;
  }

  return { employeeId: employee.id, employeeName: employee.full_name || "Employee", movedCount: visitIds.length, assignmentVerified: true };
}

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
  const foreignIds = [...new Set(candidates.map(visit => visit.assigned_employee_id).filter(Boolean))] as string[];
  if (!foreignIds.length) return [] as string[];

  const employeeRows = await service
    .from("employees")
    .select("id,full_name,email,active")
    .in("id", foreignIds)
    .or(companyFilter(companyId));
  if (employeeRows.error) throw new Error(employeeRows.error.message);

  const demoIds = new Set((employeeRows.data || [])
    .filter((row: any) => isDemoRouteIdentity(row.full_name) || isDemoRouteIdentity(row.email))
    .map((row: any) => String(row.id)));
  const repairIds = candidates
    .filter(visit => visit.assigned_employee_id && demoIds.has(visit.assigned_employee_id))
    .map(visit => visit.id);

  for (const visitId of repairIds) {
    const update = await service
      .from("visits")
      .update({ assigned_employee_id: employee.id, crew_id: employee.crew_id })
      .eq("id", visitId)
      .in("status", ["scheduled", "missed"]);
    if (update.error) throw new Error(update.error.message);
  }

  return repairIds;
}
