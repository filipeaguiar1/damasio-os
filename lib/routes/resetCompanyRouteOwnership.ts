import "server-only";

type ResetOptions = {
  cleanupDemoIdentities?: boolean;
};

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function isDemoIdentity(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("demo")
    || normalized.includes("sandbox-")
    || normalized.endsWith("@4everseasons.test")
    || normalized.endsWith("@example.com");
}

export async function resetCompanyRouteOwnership(
  service: any,
  companyId: string,
  options: ResetOptions = {},
) {
  const activeWork = await service
    .from("visits")
    .select("id,status")
    .eq("status", "in_progress")
    .or(companyFilter(companyId));
  if (activeWork.error) throw new Error(activeWork.error.message);
  if ((activeWork.data || []).length) {
    throw new Error("Route reset is blocked while a service is in progress.");
  }

  const jobs = await service
    .from("jobs")
    .select("id,default_crew_id")
    .eq("active", true)
    .or(companyFilter(companyId));
  if (jobs.error) throw new Error(jobs.error.message);
  const jobIds = (jobs.data || []).map((row: any) => String(row.id));

  let unassignedJobCount = 0;
  if (jobIds.length) {
    const cleared = await service
      .from("jobs")
      .update({
        default_crew_id: null,
        recurrence_anchor_date: null,
        default_route_order: null,
      })
      .in("id", jobIds)
      .select("id");
    if (cleared.error) throw new Error(cleared.error.message);
    unassignedJobCount = (cleared.data || []).length;
  }

  // This project intentionally does not grant DELETE on Visits to service_role.
  // Reset therefore preserves the canonical rows and removes only operational ownership.
  const removableVisits = await service
    .from("visits")
    .select("id,route_id,status")
    .in("status", ["scheduled", "on_the_way", "cancelled"])
    .or(companyFilter(companyId));
  if (removableVisits.error) throw new Error(removableVisits.error.message);

  const visitIds = (removableVisits.data || []).map((row: any) => String(row.id));
  let clearedVisitCount = 0;
  if (visitIds.length) {
    const cleared = await service
      .from("visits")
      .update({
        route_id: null,
        assigned_employee_id: null,
        crew_id: null,
        route_order: null,
      })
      .in("id", visitIds)
      .select("id");
    if (cleared.error) throw new Error(cleared.error.message);
    clearedVisitCount = (cleared.data || []).length;
  }

  let deactivatedDemoEmployeeCount = 0;
  let deactivatedDemoProfileCount = 0;
  let deactivatedDemoCrewCount = 0;

  if (options.cleanupDemoIdentities) {
    const [employees, profiles] = await Promise.all([
      service.from("employees").select("id,crew_id,full_name,email,active").eq("active", true).or(companyFilter(companyId)),
      service.from("profiles").select("id,full_name,email,active").eq("role", "employee").eq("active", true).or(companyFilter(companyId)),
    ]);
    if (employees.error) throw new Error(employees.error.message);
    if (profiles.error) throw new Error(profiles.error.message);

    const demoEmployees = (employees.data || []).filter((row: any) =>
      isDemoIdentity(row.full_name) || isDemoIdentity(row.email));
    const demoProfiles = (profiles.data || []).filter((row: any) =>
      isDemoIdentity(row.full_name) || isDemoIdentity(row.email));
    const demoEmployeeIds = demoEmployees.map((row: any) => String(row.id));
    const demoProfileIds = demoProfiles.map((row: any) => String(row.id));
    const demoCrewIds = [...new Set(demoEmployees.map((row: any) => row.crew_id).filter(Boolean))] as string[];

    if (demoEmployeeIds.length) {
      const result = await service.from("employees").update({ active: false }).in("id", demoEmployeeIds).select("id");
      if (result.error) throw new Error(result.error.message);
      deactivatedDemoEmployeeCount = (result.data || []).length;
    }
    if (demoProfileIds.length) {
      const result = await service.from("profiles").update({ active: false }).in("id", demoProfileIds).select("id");
      if (result.error) throw new Error(result.error.message);
      deactivatedDemoProfileCount = (result.data || []).length;
    }
    if (demoCrewIds.length) {
      const result = await service.from("crews").update({ active: false }).in("id", demoCrewIds).select("id");
      if (result.error) throw new Error(result.error.message);
      deactivatedDemoCrewCount = (result.data || []).length;
    }
  }

  const [jobVerification, visitVerification] = await Promise.all([
    service
      .from("jobs")
      .select("id,default_crew_id")
      .eq("active", true)
      .or(companyFilter(companyId)),
    service
      .from("visits")
      .select("id,route_id,assigned_employee_id,crew_id,route_order,status")
      .in("status", ["scheduled", "on_the_way", "cancelled"])
      .or(companyFilter(companyId)),
  ]);
  if (jobVerification.error) throw new Error(jobVerification.error.message);
  if (visitVerification.error) throw new Error(visitVerification.error.message);

  const stillAssignedJobs = (jobVerification.data || []).filter((row: any) => Boolean(row.default_crew_id));
  if (stillAssignedJobs.length) {
    throw new Error(`${stillAssignedJobs.length} Job assignment(s) remained after reset.`);
  }
  const stillAssignedVisits = (visitVerification.data || []).filter((row: any) =>
    row.route_id || row.assigned_employee_id || row.crew_id || row.route_order !== null);
  if (stillAssignedVisits.length) {
    throw new Error(`${stillAssignedVisits.length} planned Visit assignment(s) remained after reset.`);
  }

  return {
    companyId,
    unassignedJobCount,
    clearedVisitCount,
    removedVisitCount: 0,
    removedRouteCount: 0,
    deactivatedDemoEmployeeCount,
    deactivatedDemoProfileCount,
    deactivatedDemoCrewCount,
    customersPreserved: true,
    propertiesPreserved: true,
    jobsPreserved: true,
    completedHistoryPreserved: true,
  };
}
