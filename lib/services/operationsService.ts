import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
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
