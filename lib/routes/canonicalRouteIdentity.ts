import type { Lead } from "@/lib/storage";

export type CanonicalVisitStatus = "scheduled" | "in_progress" | "completed" | "missed" | "cancelled";

export type CanonicalRouteLead = Lead & {
  canonicalCustomerId?: string;
  canonicalPropertyId?: string;
  canonicalRouteId?: string;
  canonicalEmployeeId?: string;
  canonicalCrewId?: string;
  canonicalVisitStatus?: CanonicalVisitStatus;
  canonicalRouteVersion?: number;
  canonicalRouteUpdatedAt?: string;
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

function routeAuthority<T extends CanonicalRouteLead>(routeId: string, leads: T[]) {
  const version = Math.max(0, ...leads.map(lead => Number(lead.canonicalRouteVersion || 0)));
  const updatedAt = leads.reduce((latest, lead) => {
    const value = String(lead.canonicalRouteUpdatedAt || "");
    return value > latest ? value : latest;
  }, "");
  const latestVisit = leads.reduce((latest, lead) => {
    const value = String(lead.createdAt || "");
    return value > latest ? value : latest;
  }, "");
  return { routeId, leads, version, updatedAt, latestVisit };
}

export function canonicalRouteLeadsForEmployee<T extends CanonicalRouteLead>(
  leads: T[],
  employee: CanonicalEmployeeIdentity,
) {
  const matching = leads.filter(lead =>
    Boolean(lead.canonicalRouteId)
    && belongsToCanonicalEmployee(lead, employee));
  if (!matching.length) return [] as T[];

  const byRoute = new Map<string, T[]>();
  for (const lead of matching) {
    const routeId = String(lead.canonicalRouteId || "");
    if (!routeId) continue;
    const route = byRoute.get(routeId) || [];
    route.push(lead);
    byRoute.set(routeId, route);
  }

  // A legacy profile can have several Employee/Crew aliases and, consequently,
  // more than one Route for the same day. Never merge those routes in the UI.
  // Prefer explicit canonical metadata. During legacy cleanup, the authoritative
  // route is the smaller active set because Remove from today reduces membership
  // on the current Route while stale alias Routes retain the removed houses.
  const authority = [...byRoute.entries()]
    .map(([routeId, routeLeads]) => routeAuthority(routeId, routeLeads))
    .sort((left, right) =>
      right.version - left.version
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.leads.length - right.leads.length
      || right.latestVisit.localeCompare(left.latestVisit)
      || left.routeId.localeCompare(right.routeId))[0];

  if (!authority) return [] as T[];
  return [...authority.leads].sort((left, right) =>
    (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
    || String(left.canonicalVisitId || left.id).localeCompare(String(right.canonicalVisitId || right.id)));
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
