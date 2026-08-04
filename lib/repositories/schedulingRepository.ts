import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { reliableRpc } from "@/lib/supabase/reliableRpc";

export type DispatchCrew = { id: string; name: string; active: boolean; createdAt: string };
export type DispatchJob = {
  id: string;
  serviceName: string;
  frequency: string;
  nextVisitDate: string | null;
  customerName: string | null;
  address: string | null;
  propertyId: string | null;
  customerId: string | null;
  quoteId: string | null;
  crewId?: string | null;
  crewName?: string | null;
  recurrenceAnchorDate?: string | null;
  defaultRouteOrder?: number | null;
  createdAt: string;
};
export type DispatchVisit = {
  id: string;
  jobId: string | null;
  routeId: string | null;
  crewId: string | null;
  crewName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  customerId: string | null;
  customerName: string | null;
  propertyId: string | null;
  address: string | null;
  serviceName: string | null;
  scheduledDate: string;
  status: "scheduled" | "in_progress" | "completed" | "missed" | "cancelled";
  routeOrder: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds?: number | null;
  createdAt: string;
};
export type DispatchTask = { id: string; title: string; priority: "low" | "normal" | "urgent"; status: string; scheduledDate: string | null; crewId: string | null; customerName: string | null; address: string | null; propertyId: string | null };
export type DispatchActivity = { id: string; action: string; entityType: string; entityId: string | null; details: string | null; createdAt: string };
export type SchedulingDispatchBoard = { crews: DispatchCrew[]; unscheduledJobs: DispatchJob[]; assignedJobs: DispatchJob[]; visits: DispatchVisit[]; tasks: DispatchTask[]; activity: DispatchActivity[] };

const emptyBoard: SchedulingDispatchBoard = { crews: [], unscheduledJobs: [], assignedJobs: [], visits: [], tasks: [], activity: [] };

function normalizeBoard(data: unknown): SchedulingDispatchBoard {
  const board = (data || {}) as Partial<SchedulingDispatchBoard>;
  return {
    crews: Array.isArray(board.crews) ? board.crews : [],
    unscheduledJobs: Array.isArray(board.unscheduledJobs) ? board.unscheduledJobs : [],
    assignedJobs: Array.isArray(board.assignedJobs) ? board.assignedJobs : [],
    visits: Array.isArray(board.visits) ? board.visits : [],
    tasks: Array.isArray(board.tasks) ? board.tasks : [],
    activity: Array.isArray(board.activity) ? board.activity : [],
  };
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function rpcBoard(name: string, args?: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const data = await reliableRpc(supabase, name, args, { attempts: 2, timeoutMs: 18000 });
  return normalizeBoard(data || emptyBoard);
}

async function canonicalRouteBoard(routeDate = localDateKey()) {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired.");
  const search = new URLSearchParams();
  if (routeDate) search.set("date", routeDate);
  const response = await fetch(`/api/admin/routes?${search.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Canonical route board could not be loaded.");
  return normalizeBoard(result.board || emptyBoard);
}

export async function getSchedulingDispatchBoard(options: { routeDate?: string } = {}) {
  let board = emptyBoard;
  try { board = await rpcBoard("get_scheduling_dispatch_board"); } catch { /* canonical API remains authoritative */ }
  try {
    const canonical = await canonicalRouteBoard(options.routeDate || localDateKey());
    return {
      ...board,
      crews: canonical.crews,
      unscheduledJobs: canonical.unscheduledJobs,
      assignedJobs: canonical.assignedJobs,
      visits: canonical.visits,
    };
  } catch {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_company_dispatch_jobs" as never);
      if (error) throw error;
      const jobs = Array.isArray(data) ? data as DispatchJob[] : [];
      return { ...board, unscheduledJobs: jobs.filter(job => !job.crewId), assignedJobs: jobs.filter(job => Boolean(job.crewId)) };
    } catch {
      return board;
    }
  }
}

export async function assignJobCrew(jobId: string, crewId: string | null) {
  const supabase = getSupabaseBrowserClient();
  const data = await reliableRpc(supabase, "assign_job_to_crew", { p_job_id: jobId, p_crew_id: crewId }, { attempts: 2, timeoutMs: 18000 });
  return Array.isArray(data) ? data as DispatchJob[] : [];
}

function canonicalWriterRequired(operation: string): never {
  throw new Error(`${operation} is disabled here. Use Dispatch & Routes / Route Advisor so the canonical Visit is validated and published transactionally.`);
}

export async function saveJobRoutePattern(_input: { jobId: string; crewId: string; routeDate: string; routeOrder?: number }): Promise<SchedulingDispatchBoard> {
  return canonicalWriterRequired("Route pattern publication");
}
export async function scheduleJobOnRoute(_input: { jobId: string; crewId: string; routeDate: string; routeOrder?: number }): Promise<SchedulingDispatchBoard> {
  return canonicalWriterRequired("Schedule");
}
export async function moveVisitToRoute(_input: { visitId: string; crewId: string; routeDate: string; routeOrder?: number }): Promise<SchedulingDispatchBoard> {
  return canonicalWriterRequired("Move");
}
export async function updateVisitDispatchStatus(_input: { visitId: string; status: DispatchVisit["status"] }): Promise<SchedulingDispatchBoard> {
  return canonicalWriterRequired("Visit status change");
}
