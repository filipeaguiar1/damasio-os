import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CustomerPortalVisit = {
  id: string;
  serviceName: string;
  status: string;
  scheduledDate: string | null;
  crewName: string | null;
  address: string | null;
  propertyId: string | null;
  customerVisibleSummary: string | null;
  employeeNotes: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type CustomerPortalTask = {
  id: string;
  title: string;
  customerIssue: string;
  priority: "low" | "normal" | "urgent";
  status: string;
  scheduledDate: string | null;
  address: string | null;
  propertyId: string | null;
  resolvedAt: string | null;
  completionSummary: string | null;
  createdAt: string;
};

export type CustomerPortalRequest = {
  id: string;
  serviceName: string;
  message: string | null;
  status: string;
  address: string | null;
  createdAt: string;
};

export type CustomerPortalQuote = {
  id: string;
  quoteNumber: string;
  status: string;
  serviceName: string | null;
  address: string | null;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  createdAt: string;
};

export type CustomerPortalFeedback = {
  id: string;
  rating: number | null;
  comment: string | null;
  visitId: string | null;
  taskId: string | null;
  createdAt: string;
};

export type CustomerPortalProperty = {
  customerId: string;
  propertyId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  address: string;
  city: string;
  province: string;
  postalCode: string | null;
  lotSize: string | null;
  grassHeight: string | null;
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  accessNotes: string | null;
  propertyNotes: string | null;
};

export type CustomerPortalBoard = {
  property: CustomerPortalProperty | null;
  visits: CustomerPortalVisit[];
  tasks: CustomerPortalTask[];
  requests: CustomerPortalRequest[];
  quotes: CustomerPortalQuote[];
  feedback: CustomerPortalFeedback[];
};

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

function normalizeBoard(data: unknown): CustomerPortalBoard {
  const board = (data || {}) as Partial<CustomerPortalBoard>;
  return {
    property: board.property || null,
    visits: Array.isArray(board.visits) ? board.visits : [],
    tasks: Array.isArray(board.tasks) ? board.tasks : [],
    requests: Array.isArray(board.requests) ? board.requests : [],
    quotes: Array.isArray(board.quotes) ? board.quotes : [],
    feedback: Array.isArray(board.feedback) ? board.feedback : [],
  };
}

async function rpcBoard(name: string, args?: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(name as never, (args || {}) as never);
  if (error) throw new Error(error.message);
  return normalizeBoard(data || emptyBoard);
}

export function getCustomerPortalBoard() {
  return rpcBoard("get_customer_portal_board");
}

export function createCustomerPortalRequest(input: { serviceName: string; message?: string }) {
  return rpcBoard("create_customer_portal_request", {
    p_service_name: input.serviceName,
    p_message: input.message || null,
  });
}

export function submitCustomerPortalFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  return rpcBoard("submit_customer_portal_feedback", {
    p_visit_id: input.visitId || null,
    p_task_id: input.taskId || null,
    p_rating: input.rating,
    p_comment: input.comment || null,
  });
}
