"use client";

import { changeVisitStatus } from "@/lib/services/schedulingService";

export type OfflineVisitAction = {
  id: string;
  type: "visit_status";
  visitId: string;
  status: "scheduled" | "in_progress" | "completed" | "missed" | "cancelled";
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_KEY = "damasio_mobile_offline_actions_v1";
const MAX_ATTEMPTS = 8;

function readQueue(): OfflineVisitAction[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(actions: OfflineVisitAction[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(actions.slice(-100)));
}

function isNetworkLikeError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return !navigator.onLine || ["failed to fetch", "network", "timeout", "temporarily", "connection"].some(token => message.includes(token));
}

export function getOfflineActionCount() {
  return readQueue().filter(action => action.attempts < MAX_ATTEMPTS).length;
}

export function queueVisitStatusAction(visitId: string, status: OfflineVisitAction["status"], error?: unknown) {
  const queue = readQueue();
  const existing = queue.find(action => action.type === "visit_status" && action.visitId === visitId);
  const next: OfflineVisitAction = {
    id: existing?.id || crypto.randomUUID(),
    type: "visit_status",
    visitId,
    status,
    createdAt: existing?.createdAt || new Date().toISOString(),
    attempts: existing?.attempts || 0,
    lastError: error instanceof Error ? error.message : undefined
  };
  writeQueue([...queue.filter(action => action.id !== next.id), next]);
  window.dispatchEvent(new CustomEvent("damasio-offline-queue-change"));
  return next;
}

export async function runVisitStatusOrQueue(visitId: string, status: OfflineVisitAction["status"]) {
  try {
    await changeVisitStatus(visitId, status);
    return { queued: false };
  } catch (error) {
    if (!isNetworkLikeError(error)) throw error;
    queueVisitStatusAction(visitId, status, error);
    return { queued: true };
  }
}

export async function flushOfflineActionQueue() {
  const queue = readQueue();
  if (!queue.length || typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, remaining: queue.length };
  const remaining: OfflineVisitAction[] = [];
  let synced = 0;

  for (const action of queue) {
    if (action.attempts >= MAX_ATTEMPTS) {
      remaining.push(action);
      continue;
    }
    try {
      if (action.type === "visit_status") await changeVisitStatus(action.visitId, action.status);
      synced += 1;
    } catch (error) {
      remaining.push({
        ...action,
        attempts: action.attempts + 1,
        lastError: error instanceof Error ? error.message : "Sync failed."
      });
    }
  }

  writeQueue(remaining);
  window.dispatchEvent(new CustomEvent("damasio-offline-queue-change"));
  return { synced, remaining: remaining.length };
}
