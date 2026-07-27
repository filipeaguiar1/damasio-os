import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type EmployeeVisitStatus = "scheduled" | "in_progress" | "completed" | "missed";

function actionFor(status: EmployeeVisitStatus) {
  if (status === "in_progress") return "start";
  if (status === "completed") return "done";
  if (status === "missed") return "skip";
  return "reset";
}

function defaultReason(status: EmployeeVisitStatus) {
  if (status === "missed") return "Employee marked the Visit as Needs Reschedule.";
  return "";
}

async function runEmployeeVisitAction(
  visitId: string,
  action: "start" | "done" | "skip" | "reset" | "reopen",
  reason?: string,
) {
  if (!visitId) throw new Error("Choose a canonical Visit first.");

  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Employee login expired. Sign in again.");

  const response = await fetch("/api/mobile/employee/route", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      visitId,
      action,
      reason: reason?.trim() || undefined,
    }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Visit could not be updated.");
  return result;
}

export async function changeEmployeeVisitStatus(
  visitId: string,
  status: EmployeeVisitStatus,
  reason?: string,
) {
  return runEmployeeVisitAction(
    visitId,
    actionFor(status),
    reason?.trim() || defaultReason(status) || undefined,
  );
}

export async function reopenEmployeeCompletedVisit(visitId: string, reason: string) {
  if (reason.trim().length < 5) throw new Error("Reopen requires a reason with at least 5 characters.");
  return runEmployeeVisitAction(visitId, "reopen", reason);
}
