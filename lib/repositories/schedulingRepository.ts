import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type DispatchCrew = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
};

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
  createdAt: string;
};

export type DispatchTask = {
  id: string;
  title: string;
  priority: "low" | "normal" | "urgent";
  status: string;
  scheduledDate: string | null;
  crewId: string | null;
  customerName: string | null;
  address: string | null;
  propertyId: string | null;
};

export type DispatchActivity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: string | null;
  createdAt: string;
};

export type SchedulingDispatchBoard = {
  crews: DispatchCrew[];
  unscheduledJobs: DispatchJob[];
  visits: DispatchVisit[];
  tasks: DispatchTask[];
  activity: DispatchActivity[];
};

const emptyBoard: SchedulingDispatchBoard = {
  crews: [],
  unscheduledJobs: [],
  visits: [],
  tasks: [],
  activity: [],
};

function normalizeBoard(data: unknown): SchedulingDispatchBoard {
  const board = (data || {}) as Partial<SchedulingDispatchBoard>;
  return {
    crews: Array.isArray(board.crews) ? board.crews : [],
    unscheduledJobs: Array.isArray(board.unscheduledJobs) ? board.unscheduledJobs : [],
    visits: Array.isArray(board.visits) ? board.visits : [],
    tasks: Array.isArray(board.tasks) ? board.tasks : [],
    activity: Array.isArray(board.activity) ? board.activity : [],
  };
}

async function rpcBoard(name: string, args?: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(name as never, (args || {}) as never);
  if (error) throw new Error(error.message);
  return normalizeBoard(data || emptyBoard);
}

export function getSchedulingDispatchBoard() {
  return rpcBoard("get_scheduling_dispatch_board");
}

export function scheduleJobOnRoute(input: { jobId: string; crewId: string; routeDate: string; routeOrder?: number }) {
  return rpcBoard("schedule_job_on_route", {
    p_job_id: input.jobId,
    p_crew_id: input.crewId,
    p_route_date: input.routeDate,
    p_route_order: input.routeOrder || null,
  });
}

export function moveVisitToRoute(input: { visitId: string; crewId: string; routeDate: string; routeOrder?: number }) {
  return rpcBoard("move_visit_to_route", {
    p_visit_id: input.visitId,
    p_crew_id: input.crewId,
    p_route_date: input.routeDate,
    p_route_order: input.routeOrder || null,
  });
}

export function updateVisitDispatchStatus(input: { visitId: string; status: DispatchVisit["status"] }) {
  return rpcBoard("set_visit_dispatch_status", {
    p_visit_id: input.visitId,
    p_status: input.status,
  });
}
