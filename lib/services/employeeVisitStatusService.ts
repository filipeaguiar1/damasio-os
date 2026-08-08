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

  let lastError = "Visit could not reach the server.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/mobile/employee/route", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          visitId,
          action,
          reason: reason?.trim() || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        const routeId = String(result.visit?.route_id || result.visit?.routeId || "");
        window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId, visitId, status: result.visit?.status || null } }));
        if (typeof BroadcastChannel !== "undefined") {
          const broadcast = new BroadcastChannel("damasio-canonical-route");
          broadcast.postMessage({ routeId, visitId, status: result.visit?.status || null });
          broadcast.close();
        }
        return result;
      }
      lastError = result.error || `Visit update failed (${response.status}).`;
      if (![502, 503, 504].includes(response.status) || attempt === 1) throw new Error(lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === 1 || !/fetch|network|abort|load failed/i.test(lastError)) {
        throw new Error(/fetch|network|abort|load failed/i.test(lastError)
          ? "Visit could not reach the server. No status was changed. Check the connection and try again."
          : lastError);
      }
    } finally {
      window.clearTimeout(timeout);
    }
    await new Promise(resolve => window.setTimeout(resolve, 350));
  }
  throw new Error(`${lastError} No status was changed.`);
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
