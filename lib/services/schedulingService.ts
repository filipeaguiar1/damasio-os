import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
import {
  getSchedulingDispatchBoard,
  assignJobCrew,
  moveVisitToRoute,
  scheduleJobOnRoute,
  updateVisitDispatchStatus,
  type DispatchVisit,
  type SchedulingDispatchBoard,
} from "@/lib/repositories/schedulingRepository";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { dayNameFromDate, type ServiceFrequency } from "@/lib/storage";
import type { CanonicalRouteLead } from "@/lib/routes/canonicalRouteIdentity";

export type RouteLead = CanonicalRouteLead;

export function schedulingBoardToLeads(board: SchedulingDispatchBoard): RouteLead[] {
  const jobs: RouteLead[] = board.unscheduledJobs.map(job => ({
    id: job.id,
    createdAt: job.createdAt,
    name: job.customerName || "Customer",
    phone: "",
    email: "",
    address: job.address || "Address missing",
    service: job.serviceName,
    status: "new",
    subtotal: 0,
    tax: 0,
    total: 0,
    nextVisitDate: job.nextVisitDate || undefined,
    serviceFrequency: job.frequency as ServiceFrequency,
    canonicalJobId: job.id,
    canonicalCustomerId: job.customerId || undefined,
    canonicalPropertyId: job.propertyId || undefined,
    canonicalCrewId: job.crewId || undefined,
    photos: [],
  }));

  const assigned: RouteLead[] = board.assignedJobs.map(job => ({
    id: job.id,
    createdAt: job.createdAt,
    name: job.customerName || "Customer",
    phone: "",
    email: "",
    address: job.address || "Address missing",
    service: job.serviceName,
    status: "new",
    subtotal: 0,
    tax: 0,
    total: 0,
    nextVisitDate: job.nextVisitDate || undefined,
    scheduledDate: job.recurrenceAnchorDate || undefined,
    serviceDay: job.recurrenceAnchorDate ? dayNameFromDate(job.recurrenceAnchorDate) : undefined,
    serviceFrequency: job.frequency as ServiceFrequency,
    assignedCrew: job.crewName || undefined,
    routeOrder: job.defaultRouteOrder ?? undefined,
    canonicalJobId: job.id,
    canonicalCustomerId: job.customerId || undefined,
    canonicalPropertyId: job.propertyId || undefined,
    canonicalCrewId: job.crewId || undefined,
    photos: [],
  }));

  const visits: RouteLead[] = board.visits
    .filter(visit => visit.status !== "cancelled" && visit.status !== "missed")
    .map(visit => ({
      id: visit.id,
      createdAt: visit.createdAt,
      name: visit.customerName || "Customer",
      phone: "",
      email: "",
      address: visit.address || "Address missing",
      service: visit.serviceName || "Property Service",
      status: visit.status === "completed" ? "completed" : "booked",
      subtotal: 0,
      tax: 0,
      total: 0,
      scheduledDate: visit.scheduledDate,
      nextVisitDate: visit.scheduledDate,
      assignedCrew: visit.employeeName || visit.crewName || undefined,
      serviceDay: dayNameFromDate(visit.scheduledDate),
      routeOrder: visit.routeOrder ?? undefined,
      photos: [],
      canonicalVisitId: visit.id,
      canonicalJobId: visit.jobId || undefined,
      canonicalRouteId: visit.routeId || undefined,
      canonicalCustomerId: visit.customerId || undefined,
      canonicalPropertyId: visit.propertyId || undefined,
      canonicalEmployeeId: visit.employeeId || undefined,
      canonicalCrewId: visit.crewId || undefined,
      canonicalVisitStatus: visit.status,
      visitStartedAt: visit.startedAt || undefined,
      visitFinishedAt: visit.finishedAt || undefined,
      visitDurationSeconds: visit.durationSeconds ?? undefined,
    }));

  return [...jobs, ...assigned, ...visits];
}

export async function assignJobToCrew(jobId:string,crewId:string|null){if(!jobId)throw new Error("Choose a job first.");await assignJobCrew(jobId,crewId);invalidateQuery("scheduling:");}

export async function publishJobRoutePattern(input:{jobId:string;crewId:string;routeDate:string;routeOrder?:number}){
  if(!input.jobId||!input.crewId||!input.routeDate)throw new Error("Job, crew and route date are required.");
  const board=await scheduleJobOnRoute(input);
  const savedVisit=board.visits.find(visit=>visit.jobId===input.jobId&&visit.crewId===input.crewId&&visit.scheduledDate===input.routeDate&&visit.status!=="cancelled");
  if(!savedVisit)throw new Error("The route preview was generated, but the dated visit was not saved. Please try again.");
  invalidateQuery("scheduling:");
  return board;
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

async function changeEmployeeVisitStatus(visitId: string, status: "in_progress" | "completed") {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Employee login expired. Sign in again.");

  const response = await fetch("/api/mobile/employee/route", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      visitId,
      action: status === "in_progress" ? "start" : "done",
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Visit could not be updated.");
  invalidateQuery("scheduling:");
  return result;
}

export async function changeVisitStatus(visitId: string, status: DispatchVisit["status"]) {
  if (!visitId) throw new Error("Choose a visit first.");
  if (status === "in_progress" || status === "completed") {
    return changeEmployeeVisitStatus(visitId, status);
  }
  const board = await updateVisitDispatchStatus({ visitId, status });
  invalidateQuery("scheduling:");
  return board;
}
