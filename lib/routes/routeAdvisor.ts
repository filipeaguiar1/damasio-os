export type AdvisorPoint = { latitude: number; longitude: number };

export type AdvisorEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  start: AdvisorPoint | null;
  dailyCapacity: number;
};

export type AdvisorHome = {
  id: string;
  crewId?: string;
  nextVisitDate?: string;
  point: AdvisorPoint;
};

export type AdvisorVisit = {
  jobId?: string;
  date: string;
  employeeId?: string;
  crewId?: string;
  status?: string;
  point?: AdvisorPoint | null;
};

export type RouteAdvisorRecommendation = {
  employeeId: string;
  employeeName: string;
  crewId: string;
  date: string;
  score: number;
  capacity: number;
  existingStops: number;
  selectedStops: number;
  remainingCapacity: number;
  estimatedExtraKm: number;
  reasons: string[];
};

export const DEFAULT_ROUTE_DAILY_CAPACITY = 16;

function safeCapacity(value: number | null | undefined) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROUTE_DAILY_CAPACITY;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function planningDates(startDate: string, days = 7) {
  const start = parseDate(startDate);
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const value = new Date(start);
    value.setDate(value.getDate() + index);
    return dateKey(value);
  });
}

export function haversineKm(a: AdvisorPoint, b: AdvisorPoint) {
  const radius = 6371;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = toRadians(b.latitude - a.latitude);
  const longitude = toRadians(b.longitude - a.longitude);
  const first = toRadians(a.latitude);
  const second = toRadians(b.latitude);
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(first) * Math.cos(second) * Math.sin(longitude / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function dayDistance(left?: string, right?: string) {
  if (!left || !right) return 0;
  return Math.abs(Math.round((parseDate(left).getTime() - parseDate(right).getTime()) / 86_400_000));
}

export function recommendRoutePlacements(input: {
  employees: AdvisorEmployee[];
  homes: AdvisorHome[];
  visits: AdvisorVisit[];
  startDate: string;
  days?: number;
}) {
  const dates = planningDates(input.startDate, input.days || 7);
  const recommendations: RouteAdvisorRecommendation[] = [];

  for (const employee of input.employees) {
    if (!employee.start) continue;
    const capacity = safeCapacity(employee.dailyCapacity);

    for (const date of dates) {
      const existing = input.visits.filter(visit =>
        visit.date === date
        && visit.status !== "cancelled"
        && (visit.employeeId === employee.employeeId || visit.crewId === employee.crewId));
      const existingJobIds = new Set(existing.map(visit => visit.jobId).filter(Boolean));
      const homesToAdd = input.homes.filter(home => !existingJobIds.has(home.id));
      const totalStops = existing.length + homesToAdd.length;
      if (totalStops > capacity) continue;

      const anchors = [employee.start, ...existing.flatMap(visit => visit.point ? [visit.point] : [])];
      const distances = homesToAdd.map(home => Math.min(...anchors.map(anchor => haversineKm(anchor, home.point))));
      const estimatedExtraKm = Number(distances.reduce((sum, distance) => sum + distance, 0).toFixed(1));
      const duePenalty = input.homes.reduce((sum, home) => sum + Math.min(14, dayDistance(home.nextVisitDate, date)), 0);
      const continuityCount = input.homes.filter(home => home.crewId === employee.crewId).length;
      const loadRatio = capacity ? existing.length / capacity : 1;
      const loadPenalty = loadRatio * 18;
      const distancePenalty = estimatedExtraKm * 5.2;
      const score = Math.max(0, Math.min(100, Math.round(
        100 - distancePenalty - duePenalty * 2.5 - loadPenalty + continuityCount * 7,
      )));
      const remainingCapacity = capacity - totalStops;
      const reasons = [
        `${existing.length}/${capacity} daily capacity already used; ${remainingCapacity} slots remain`,
        estimatedExtraKm <= 3
          ? "Very close to the current route"
          : estimatedExtraKm <= 8
            ? "Reasonable regional fit"
            : "Adds noticeable travel",
      ];
      if (continuityCount) reasons.push(`${continuityCount} home${continuityCount === 1 ? "" : "s"} already prefer this employee`);
      if (duePenalty === 0) reasons.push("Matches the current due date");

      recommendations.push({
        employeeId: employee.id,
        employeeName: employee.name,
        crewId: employee.crewId,
        date,
        score,
        capacity,
        existingStops: existing.length,
        selectedStops: input.homes.length,
        remainingCapacity,
        estimatedExtraKm,
        reasons,
      });
    }
  }

  return recommendations.sort((a, b) =>
    b.score - a.score
    || a.estimatedExtraKm - b.estimatedExtraKm
    || b.remainingCapacity - a.remainingCapacity
    || a.date.localeCompare(b.date));
}
