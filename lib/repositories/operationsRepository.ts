import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type OperationQuote = {
  id: string;
  quoteNumber: string;
  status: "draft" | "sent" | "approved" | "declined" | "expired";
  customerId: string;
  propertyId: string;
  customerName: string | null;
  address: string | null;
  serviceName: string | null;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  createdAt: string;
};

export type OperationJob = {
  id: string;
  serviceName: string;
  frequency: string;
  active: boolean;
  nextVisitDate: string | null;
  customerName: string | null;
  address: string | null;
  quoteId: string | null;
  propertyId: string | null;
  createdAt: string;
};

export type OperationTask = {
  id: string;
  title: string;
  customerIssue: string;
  priority: "low" | "normal" | "urgent";
  status: string;
  scheduledDate: string | null;
  customerName: string | null;
  address: string | null;
  propertyId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  completionSummary: string | null;
};

export type OperationActivity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: string | null;
  createdAt: string;
};

export type OperationsBoard = {
  quotes: OperationQuote[];
  jobs: OperationJob[];
  tasks: OperationTask[];
  activity: OperationActivity[];
};

const emptyBoard: OperationsBoard = { quotes: [], jobs: [], tasks: [], activity: [] };

function normalizeBoard(data: unknown): OperationsBoard {
  const board = (data || {}) as Partial<OperationsBoard>;
  return {
    quotes: Array.isArray(board.quotes) ? board.quotes : [],
    jobs: Array.isArray(board.jobs) ? board.jobs : [],
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

export function getOperationsBoard() {
  return rpcBoard("get_operations_board");
}

export function createOperationQuote(input: {
  customerId: string;
  propertyId: string;
  serviceName: string;
  subtotal: number;
  notes?: string;
}) {
  return rpcBoard("create_operation_quote", {
    p_customer_id: input.customerId,
    p_property_id: input.propertyId,
    p_service_name: input.serviceName,
    p_subtotal: input.subtotal,
    p_notes: input.notes || null,
  });
}

export function updateOperationQuoteStatus(quoteId: string, status: OperationQuote["status"]) {
  return rpcBoard("set_operation_quote_status", { p_quote_id: quoteId, p_status: status });
}

export function createOperationTask(input: {
  customerId: string;
  propertyId: string;
  title: string;
  customerIssue: string;
  priority: OperationTask["priority"];
  scheduledDate?: string;
}) {
  return rpcBoard("create_operation_task", {
    p_customer_id: input.customerId,
    p_property_id: input.propertyId,
    p_title: input.title,
    p_customer_issue: input.customerIssue,
    p_priority: input.priority,
    p_scheduled_date: input.scheduledDate || null,
  });
}

export function resolveOperationTask(taskId: string, completionSummary: string) {
  return rpcBoard("resolve_operation_task", {
    p_task_id: taskId,
    p_completion_summary: completionSummary,
  });
}
