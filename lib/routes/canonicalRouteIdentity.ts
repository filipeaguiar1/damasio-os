import type { Lead } from "@/lib/storage";

export type CanonicalVisitStatus = "scheduled" | "in_progress" | "completed" | "missed" | "cancelled";

export type CanonicalRouteLead = Lead & {
  canonicalCustomerId?: string;
  canonicalPropertyId?: string;
  canonicalRouteId?: string;
  canonicalEmployeeId?: string;
  canonicalCrewId?: string;
  canonicalVisitStatus?: CanonicalVisitStatus;
};

export type CanonicalEmployeeIdentity = {
  id: string;
  crewId: string;
  employeeIds?: string[];
  crewIds?: string[];
};

export type CanonicalRouteWarning = {
  visitId: string;
  missing: string[];
};

export function belongsToCanonicalEmployee(
  lead: CanonicalRouteLead,
  employee: CanonicalEmployeeIdentity,
) {
  // profile_id is the stable login identity. Older databases may contain more than
  // one Employee/Crew row for that profile, so compare every exact database alias.
  // Names and email addresses are intentionally never used as operational identity.
  const employeeIds = new Set([
    employee.id,
    ...(employee.employeeIds || []),
  ].filter(Boolean));
  const crewIds = new Set([
    employee.crewId,
    ...(employee.crewIds || []),
  ].filter(Boolean));

  const employeeMatch = Boolean(
    lead.canonicalEmployeeId
    && employeeIds.has(lead.canonicalEmployeeId),
  );
  const crewMatch = Boolean(
    lead.canonicalCrewId
    && crewIds.has(lead.canonicalCrewId),
  );
  return employeeMatch || crewMatch;
}

export function canonicalRouteLeadsForEmployee<T extends CanonicalRouteLead>(
  leads: T[],
  employee: CanonicalEmployeeIdentity,
) {
  // Resolve the profile to a canonical route once, then return every stop from
  // that routeId. This prevents duplicate historical Employee/Crew rows from
  // splitting one published route into partial lists on Admin web or mobile.
  const routeIds = new Set(
    leads
      .filter(lead => lead.canonicalRouteId && belongsToCanonicalEmployee(lead, employee))
      .map(lead => String(lead.canonicalRouteId)),
  );
  if (!routeIds.size) return [] as T[];
  return leads.filter(lead => Boolean(
    lead.canonicalRouteId
    && routeIds.has(String(lead.canonicalRouteId)),
  ));
}

export function canonicalRouteWarnings(leads: CanonicalRouteLead[]): CanonicalRouteWarning[] {
  const warnings: CanonicalRouteWarning[] = [];

  for (const lead of leads) {
    // Forecast Visits are not published route stops. Only a Visit already attached
    // to a canonical Route can be reported as a broken route stop.
    if (!lead.canonicalVisitId || !lead.canonicalRouteId) continue;

    const missing = [
      !lead.canonicalCustomerId && "customerId",
      !lead.canonicalPropertyId && "propertyId",
      !lead.canonicalJobId && "jobId",
      !lead.canonicalEmployeeId && "employeeId",
      !lead.canonicalCrewId && "crewId",
    ].filter((value): value is string => Boolean(value));

    if (missing.length) warnings.push({ visitId: lead.canonicalVisitId, missing });
  }

  return warnings;
}
