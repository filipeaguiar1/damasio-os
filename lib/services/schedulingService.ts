import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
import {
  getSchedulingDispatchBoard,
  moveVisitToRoute,
  scheduleJobOnRoute,
  updateVisitDispatchStatus,
  type DispatchVisit,
} from "@/lib/repositories/schedulingRepository";

export async function loadSchedulingDispatchBoard(options?: { force?: boolean }) {
  return cachedQuery("scheduling:dispatch-board", () => getSchedulingDispatchBoard(), { ttlMs: 20_000, force: options?.force });
}

export async function assignJobToRoute(input: { jobId: string; crewId: string; routeDate: string; routeOrder?: number }) {
  if (!input.jobId) throw new Error("Choose a job first.");
  if (!input.crewId) throw new Error("Choose a crew first.");
  if (!input.routeDate) throw new Error("Choose a route date first.");
  const board = await scheduleJobOnRoute(input);
  invalidateQuery("scheduling:");
  return board;
}

export async function rescheduleVisit(input: { visitId: string; crewId: string; routeDate: string; routeOrder?: number }) {
  if (!input.visitId) throw new Error("Choose a visit first.");
  if (!input.crewId) throw new Error("Choose a crew first.");
  if (!input.routeDate) throw new Error("Choose a route date first.");
  const board = await moveVisitToRoute(input);
  invalidateQuery("scheduling:");
  return board;
}

export async function changeVisitStatus(visitId: string, status: DispatchVisit["status"]) {
  if (!visitId) throw new Error("Choose a visit first.");
  const board = await updateVisitDispatchStatus({ visitId, status });
  invalidateQuery("scheduling:");
  return board;
}
