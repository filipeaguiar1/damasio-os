import type { Lead } from "@/lib/storage";

export type CanonicalRouteLead = Lead & {
  canonicalCustomerId?: string;
  canonicalPropertyId?: string;
  canonicalRouteId?: string;
  canonicalEmployeeId?: string;
  canonicalCrewId?: string;
};

export type CanonicalEmployeeIdentity = {
  id: string;
  crewId: string;
};

export function belongsToCanonicalEmployee(
  lead: CanonicalRouteLead,
  employee: CanonicalEmployeeIdentity,
) {
  if (lead.canonicalEmployeeId) return lead.canonicalEmployeeId === employee.id;
  return Boolean(lead.canonicalCrewId && lead.canonicalCrewId === employee.crewId);
}

export function canonicalRouteWarnings(leads: CanonicalRouteLead[]) {
  return leads.flatMap((lead) => {
    if (!lead.canonicalVisitId) return [];
    const missing = [
      !lead.canonicalCustomerId && "customerId",
      !lead.canonicalPropertyId && "propertyId",
      !lead.canonicalJobId && "jobId",
      !lead.canonicalVisitId && "visitId",
      !lead.canonicalRouteId && "routeId",
      !lead.canonicalEmployeeId && "employeeId",
      !lead.canonicalCrewId && "crewId",
    ].filter(Boolean) as string[];
    return missing.length ? [{ visitId: lead.canonicalVisitId, missing }] : [];
  });
}
