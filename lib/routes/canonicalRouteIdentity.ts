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
};

export type CanonicalRouteWarning = {
  visitId: string;
  missing: string[];
};

export function belongsToCanonicalEmployee(
  lead: CanonicalRouteLead,
  employee: CanonicalEmployeeIdentity,
) {
  // Employee records can have historical duplicate IDs, while the Visit keeps the
  // same canonical Crew assignment. Either exact canonical identifier therefore
  // resolves to the same operational Employee route; no email/name fallback exists.
  const employeeMatch = Boolean(
    lead.canonicalEmployeeId
    && employee.id
    && lead.canonicalEmployeeId === employee.id,
  );
  const crewMatch = Boolean(
    lead.canonicalCrewId
    && employee.crewId
    && lead.canonicalCrewId === employee.crewId,
  );
  return employeeMatch || crewMatch;
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
