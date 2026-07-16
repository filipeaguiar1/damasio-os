import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
import {
  getSchedulingDispatchBoard,
  assignJobCrew,
  moveVisitToRoute,
  scheduleJobOnRoute,
  saveJobRoutePattern,
  updateVisitDispatchStatus,
  type DispatchVisit,
  type SchedulingDispatchBoard,
} from "@/lib/repositories/schedulingRepository";
import { dayNameFromDate, type Lead, type ServiceFrequency } from "@/lib/storage";

export function schedulingBoardToLeads(board: SchedulingDispatchBoard): Lead[] {
  const jobs: Lead[] = board.unscheduledJobs.map(job => ({
    id: job.id, createdAt: job.createdAt, name: job.customerName || "Customer", phone: "", email: "",
    address: job.address || "Address missing", service: job.serviceName, status: "new", subtotal: 0, tax: 0, total: 0,
    nextVisitDate: job.nextVisitDate || undefined, serviceFrequency: job.frequency as ServiceFrequency, photos: []
  }));
  const assigned: Lead[] = board.assignedJobs.map(job => ({
    id: job.id, createdAt: job.createdAt, name: job.customerName || "Customer", phone: "", email: "",
    address: job.address || "Address missing", service: job.serviceName, status: "new", subtotal: 0, tax: 0, total: 0,
    nextVisitDate: job.nextVisitDate || undefined, scheduledDate: job.recurrenceAnchorDate || undefined,
    serviceDay: job.recurrenceAnchorDate ? dayNameFromDate(job.recurrenceAnchorDate) : undefined,
    serviceFrequency: job.frequency as ServiceFrequency, assignedCrew: job.crewName || undefined,
    routeOrder: job.defaultRouteOrder ?? undefined, canonicalJobId: job.id, photos: []
  }));
  const visits: Lead[] = board.visits.filter(visit => visit.status !== "cancelled" && visit.status !== "missed").map(visit => ({
    id: visit.id, createdAt: visit.createdAt, name: visit.customerName || "Customer", phone: "", email: "",
    address: visit.address || "Address missing", service: visit.serviceName || "Property Service",
    status: visit.status === "completed" ? "completed" : "booked", subtotal: 0, tax: 0, total: 0,
    scheduledDate: visit.scheduledDate, nextVisitDate: visit.scheduledDate, assignedCrew: visit.crewName || undefined,
    serviceDay: dayNameFromDate(visit.scheduledDate), routeOrder: visit.routeOrder ?? undefined, photos: [], canonicalVisitId: visit.id, canonicalJobId: visit.jobId || undefined,
    visitStartedAt: visit.startedAt || undefined, visitFinishedAt: visit.finishedAt || undefined, visitDurationSeconds: visit.durationSeconds ?? undefined
  }));
  return [...jobs, ...assigned, ...visits];
}

export async function assignJobToCrew(jobId:string,crewId:string|null){if(!jobId)throw new Error("Choose a job first.");await assignJobCrew(jobId,crewId);invalidateQuery("scheduling:");}

export async function publishJobRoutePattern(input:{jobId:string;crewId:string;routeDate:string;routeOrder?:number}){
  if(!input.jobId||!input.crewId||!input.routeDate)throw new Error("Job, crew and route date are required.");
  const board=await saveJobRoutePattern(input);invalidateQuery("scheduling:");return board;
}

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
