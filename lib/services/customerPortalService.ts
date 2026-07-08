import { cachedQuery, invalidateQuery } from "@/lib/performance/queryCache";
import {
  createCustomerPortalRequest,
  getCustomerPortalBoard,
  submitCustomerPortalFeedback,
} from "@/lib/repositories/customerPortalRepository";

export async function loadCustomerPortal(options?: { force?: boolean }) {
  return cachedQuery("customer-portal:board", () => getCustomerPortalBoard(), { ttlMs: 20_000, force: options?.force });
}

export async function addCustomerServiceRequest(input: { serviceName: string; message?: string }) {
  if (!input.serviceName.trim()) throw new Error("Choose a service first.");
  const board = await createCustomerPortalRequest(input);
  invalidateQuery("customer-portal:");
  return board;
}

export async function addCustomerFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  if (!input.visitId && !input.taskId) throw new Error("Choose a completed item first.");
  if (input.rating < 1 || input.rating > 5) throw new Error("Rating must be between 1 and 5.");
  const board = await submitCustomerPortalFeedback(input);
  invalidateQuery("customer-portal:");
  return board;
}
