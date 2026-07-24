import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createOperationQuote,
  createOperationTask,
  getOperationsBoard,
  resolveOperationTask,
  updateOperationQuoteStatus,
  type OperationQuote,
  type OperationTask,
} from "@/lib/repositories/operationsRepository";

export async function loadOperationsBoard(options?: { force?: boolean }) {
  return cachedQuery("operations:board", () => getOperationsBoard(), { ttlMs: 20_000, force: options?.force });
}

export async function addQuoteToProperty(input: {
  customerId: string;
  propertyId: string;
  serviceName: string;
  subtotal: number;
  notes?: string;
}) {
  if (!input.customerId || !input.propertyId) throw new Error("Choose a customer/property first.");
  if (!input.serviceName.trim()) throw new Error("Service name is required.");
  const board = await createOperationQuote(input);
  invalidateQuery("operations:");
  return board;
}

export async function changeQuoteStatus(quoteId: string, status: OperationQuote["status"]) {
  const board = await updateOperationQuoteStatus(quoteId, status);
  invalidateQuery("operations:");
  return board;
}

export async function approveQuoteAndInvite(input: { quoteId: string; finalTotal: number; revisionNote?: string; sendInvite?: boolean }) {
  if (!input.quoteId) throw new Error("Choose a quote first.");
  if (!Number.isFinite(input.finalTotal) || input.finalTotal <= 0) throw new Error("Enter a valid final total.");
  const supabase = getSupabaseBrowserClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Sign in as Admin before approving a quote.");
  const response = await fetch(`/api/master/quotes/${input.quoteId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ finalTotal: input.finalTotal, revisionNote: input.revisionNote || "", sendInvite: input.sendInvite ?? true }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Quote approval failed.");
  invalidateQuery("operations:");
  return result as { quoteId: string; invoiceId?: string; invoiceNumber?: string; inviteSent: boolean; message: string };
}

export async function addTaskToProperty(input: {
  customerId: string;
  propertyId: string;
  title: string;
  customerIssue: string;
  priority: OperationTask["priority"];
  scheduledDate?: string;
}) {
  if (!input.customerId || !input.propertyId) throw new Error("Choose a customer/property first.");
  if (!input.title.trim()) throw new Error("Task title is required.");
  if (!input.customerIssue.trim()) throw new Error("Customer issue is required.");
  const board = await createOperationTask(input);
  invalidateQuery("operations:");
  return board;
}

export async function markTaskResolved(taskId: string, summary = "Task resolved by Admin.") {
  const board = await resolveOperationTask(taskId, summary);
  invalidateQuery("operations:");
  return board;
}
