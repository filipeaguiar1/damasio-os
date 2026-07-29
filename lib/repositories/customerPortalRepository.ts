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

export type PaymentsVisit = {
  id: string;
  jobId: string | null;
  serviceName: string;
  scheduledDate: string | null;
  status: string;
  address: string | null;
  city?: string | null;
  crewName?: string | null;
  routeOrder?: number | null;
  finishedAt?: string | null;
  customerVisibleSummary?: string | null;
  feedbackRating?: number | null;
  feedbackComment?: string | null;
};

export type PaymentsAgreement = {
  id: string;
  jobId: string;
  billingModel: string;
  collectionTiming: string;
  customerOrigin: "platform" | "company";
  contractStartsOn: string | null;
  contractEndsOn: string | null;
  feedbackWindowHours: number;
  prepaidPlanType: "monthly" | "seasonal" | null;
  planBillingDay: number;
  serviceStartDay: number | null;
  active: boolean;
  serviceFrequency: string;
  serviceName: string;
};

export type PaymentsBillingCycle = {
  id: string;
  agreementId: string;
  cycleType: "monthly" | "seasonal";
  periodStartsOn: string;
  periodEndsOn: string;
  chargeDueOn: string;
  serviceAvailableOn: string;
  state: string;
  paidAt: string | null;
};

export type PaymentsBillingEvent = {
  id: string;
  visitId: string;
  state: string;
  visitCompletedAt: string;
  feedbackDeadlineAt: string;
  reopenedFeedbackDeadlineAt: string | null;
  eligibleToChargeAt: string | null;
  chargedAt: string | null;
  transferredAt: string | null;
  activeTaskId: string | null;
};

export type PaymentsOpenTask = {
  id: string;
  visitId: string | null;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type CustomerPaymentsVisitsPortal = {
  upcomingVisits: PaymentsVisit[];
  visitHistory: PaymentsVisit[];
  agreements: PaymentsAgreement[];
  billingCycles: PaymentsBillingCycle[];
  billingEvents: PaymentsBillingEvent[];
  openTasks: PaymentsOpenTask[];
};

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
const emptyPaymentsPortal: CustomerPaymentsVisitsPortal = { upcomingVisits: [], visitHistory: [], agreements: [], billingCycles: [], billingEvents: [], openTasks: [] };

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

function normalizePaymentsPortal(data: unknown): CustomerPaymentsVisitsPortal {
  const portal = (data || {}) as Partial<CustomerPaymentsVisitsPortal>;
  return {
    upcomingVisits: Array.isArray(portal.upcomingVisits) ? portal.upcomingVisits : [],
    visitHistory: Array.isArray(portal.visitHistory) ? portal.visitHistory : [],
    agreements: Array.isArray(portal.agreements) ? portal.agreements : [],
    billingCycles: Array.isArray(portal.billingCycles) ? portal.billingCycles : [],
    billingEvents: Array.isArray(portal.billingEvents) ? portal.billingEvents : [],
    openTasks: Array.isArray(portal.openTasks) ? portal.openTasks : [],
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

export async function getCustomerPaymentsVisitsPortal() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_customer_payments_visits_portal" as never);
  if (error) throw new Error(error.message);
  return normalizePaymentsPortal(data || emptyPaymentsPortal);
}

async function callCustomerPortalAction(body: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient() as any;
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error("Customer session expired.");
  const response = await fetch("/api/customer/portal-actions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Customer portal action failed.");
  return getCustomerPortalBoard();
}

export async function createCustomerPortalRequest(input: { serviceName: string; message?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const rpc = await supabase.rpc("create_customer_portal_request", {
    p_service_name: input.serviceName,
    p_message: input.message || null,
  });
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const fallbackAllowed = rpc.error.code === "PGRST202"
    || /could not find the function public\.create_customer_portal_request|schema cache|permission denied/i.test(String(rpc.error.message || ""));
  if (!fallbackAllowed) throw new Error(rpc.error.message);

  const board = await getCustomerPortalBoard();
  if (!board.property?.propertyId) throw new Error("Customer property not found for this account.");
  return callCustomerPortalAction({
    action: "request",
    propertyId: board.property.propertyId,
    serviceName: input.serviceName,
    message: input.message || null,
  });
}

export async function submitCustomerPortalFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const args = {
    p_visit_id: input.visitId || null,
    p_task_id: input.taskId || null,
    p_rating: input.rating,
    p_comment: input.comment || null,
  };
  const rpc = await supabase.rpc("submit_customer_portal_feedback", args);
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const fallbackAllowed = rpc.error.code === "PGRST202"
    || /could not find the function public\.submit_customer_portal_feedback|schema cache|permission denied/i.test(String(rpc.error.message || ""));
  if (!fallbackAllowed) throw new Error(rpc.error.message);

  return callCustomerPortalAction({
    action: "feedback",
    visitId: input.visitId || null,
    taskId: input.taskId || null,
    rating: input.rating,
    comment: input.comment || null,
  });
}
