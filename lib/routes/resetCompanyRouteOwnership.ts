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

  const removableVisits = await service
    .from("visits")
    .select("id,route_id,status")
    .in("status", ["scheduled", "missed", "on_the_way", "cancelled"])
    .or(companyFilter(companyId));
  if (removableVisits.error) throw new Error(removableVisits.error.message);

  const visitIds = (removableVisits.data || []).map((row: any) => String(row.id));
  const affectedRouteIds = [...new Set(
    (removableVisits.data || []).map((row: any) => row.route_id).filter(Boolean),
  )] as string[];

  let removedVisitCount = 0;
  if (visitIds.length) {
    const deleted = await service.from("visits").delete().in("id", visitIds).select("id");
    if (deleted.error) throw new Error(deleted.error.message);
    removedVisitCount = (deleted.data || []).length;
  }

  let removedRouteCount = 0;
  if (affectedRouteIds.length) {
    const remaining = await service
      .from("visits")
      .select("route_id")
      .in("route_id", affectedRouteIds)
      .not("route_id", "is", null);
    if (remaining.error) throw new Error(remaining.error.message);
    const usedRouteIds = new Set((remaining.data || []).map((row: any) => String(row.route_id)));
    const emptyRouteIds = affectedRouteIds.filter(id => !usedRouteIds.has(id));
    if (emptyRouteIds.length) {
      const deletedRoutes = await service.from("routes").delete().in("id", emptyRouteIds).select("id");
      if (deletedRoutes.error) throw new Error(deletedRoutes.error.message);
      removedRouteCount = (deletedRoutes.data || []).length;
    }
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

  const verification = await service
    .from("jobs")
    .select("id,default_crew_id")
    .eq("active", true)
    .or(companyFilter(companyId));
  if (verification.error) throw new Error(verification.error.message);
  const stillAssigned = (verification.data || []).filter((row: any) => Boolean(row.default_crew_id));
  if (stillAssigned.length) {
    throw new Error(`${stillAssigned.length} Job assignment(s) remained after reset.`);
  }

  return {
    companyId,
    unassignedJobCount,
    removedVisitCount,
    removedRouteCount,
    deactivatedDemoEmployeeCount,
    deactivatedDemoProfileCount,
    deactivatedDemoCrewCount,
    customersPreserved: true,
    propertiesPreserved: true,
    jobsPreserved: true,
  };
}
