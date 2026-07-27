"use client";

import {
  changeEmployeeVisitStatus,
  reopenEmployeeCompletedVisit,
  type EmployeeVisitStatus,
} from "@/lib/services/employeeVisitStatusService";

export type OfflineVisitAction = {
  id: string;
  type: "visit_status";
  visitId: string;
  status: EmployeeVisitStatus;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

// Operational Visit writes are never persisted in localStorage. Supabase remains
// the only source of truth; a network failure is shown to the Employee and retried
// only after the user explicitly performs the action again.
export function getOfflineActionCount() {
  return 0;
}

export function queueVisitStatusAction(
  visitId: string,
  status: EmployeeVisitStatus,
  error?: unknown,
): OfflineVisitAction {
  return {
    id: crypto.randomUUID(),
    type: "visit_status",
    visitId,
    status,
    createdAt: new Date().toISOString(),
    attempts: 1,
    lastError: error instanceof Error ? error.message : "Offline operational writes are disabled.",
  };
}

export async function runVisitStatusOrQueue(
  visitId: string,
  status: EmployeeVisitStatus,
  reason?: string,
) {
  let resolvedReason = reason?.trim() || "";
  if (status === "scheduled" && resolvedReason.length < 5) {
    resolvedReason = window.prompt("Why are you resetting this Visit? A reason is required.")?.trim() || "";
    if (resolvedReason.length < 5) throw new Error("Reset cancelled. A reason with at least 5 characters is required.");
  }
  try {
    await changeEmployeeVisitStatus(visitId, status, resolvedReason || undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (status !== "scheduled" || !/completed.*reopen|requires reopen/i.test(message)) throw error;

    const confirmation = window.prompt(
      "This Visit is completed. Employee Reopen is allowed only for your own Visit today, within 15 minutes and before Task, feedback or financial processing. Type REOPEN to continue.",
    );
    if (confirmation?.trim().toUpperCase() !== "REOPEN") {
      throw new Error("Completed Visit Reopen cancelled.");
    }
    await reopenEmployeeCompletedVisit(visitId, resolvedReason);
  }
  return { queued: false };
}

export async function flushOfflineActionQueue() {
  return { synced: 0, remaining: 0 };
}
