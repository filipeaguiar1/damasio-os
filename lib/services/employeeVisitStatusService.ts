"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type EmployeeVisitStatus = "scheduled" | "in_progress" | "completed" | "missed";

const actionByStatus: Record<EmployeeVisitStatus, "reset" | "start" | "done" | "skip"> = {
  scheduled: "reset",
  in_progress: "start",
  completed: "done",
  missed: "skip",
};

export async function changeEmployeeVisitStatus(visitId: string, status: EmployeeVisitStatus) {
  if (!visitId) throw new Error("Choose a visit first.");
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Employee session expired. Sign in again.");

  const response = await fetch("/api/mobile/employee/route", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ visitId, action: actionByStatus[status] }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Visit could not be updated.");
  return result.visit;
}
