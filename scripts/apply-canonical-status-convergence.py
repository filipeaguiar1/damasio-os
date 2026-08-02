from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "lib/services/routeMapService.ts",
    '''export async function loadEmployeeRouteMapContext(
  routeDate: string,
  _crewName: string,
): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !isSupabaseConfigured()) return emptyContext;
  const snapshot = await loadCanonicalRouteSnapshot({ routeDate });
  return contextFromSnapshot(snapshot);
}

export function applyEmployeeRouteMapContext(''',
    '''export async function loadEmployeeRouteMapContext(
  routeDate: string,
  _crewName: string,
): Promise<EmployeeRouteMapContext> {
  if (!routeDate || !isSupabaseConfigured()) return emptyContext;
  const snapshot = await loadCanonicalRouteSnapshot({ routeDate });
  return contextFromSnapshot(snapshot);
}

export async function loadEmployeeRouteMapContextUntilStatus(
  routeDate: string,
  crewName: string,
  visitId: string,
  expectedStatus: string,
): Promise<EmployeeRouteMapContext> {
  let latest = await loadEmployeeRouteMapContext(routeDate, crewName);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stop = latest.stops.find(item => item.visitId === visitId);
    if (stop?.status === expectedStatus) return latest;
    await new Promise(resolve => window.setTimeout(resolve, 300 + attempt * 100));
    latest = await loadEmployeeRouteMapContext(routeDate, crewName);
  }
  throw new Error(`The Visit was saved, but the canonical Route did not converge to ${expectedStatus}. Refresh and verify before continuing.`);
}

export function applyEmployeeRouteMapContext(''',
)

replace_once(
    "app/employee/route/page.tsx",
    'import { applyEmployeeRouteMapContext, loadEmployeeRouteMapContext, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";',
    'import { applyEmployeeRouteMapContext, loadEmployeeRouteMapContext, loadEmployeeRouteMapContextUntilStatus, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";',
)

replace_once(
    "app/employee/route/page.tsx",
    '''  async function start(){if(!selected)return;try{if(selected.canonicalVisitId)await runVisitStatusOrQueue(selected.canonicalVisitId,"in_progress");else startServiceSession(selected.id,profile.name,crew);setCommentOpen(false);setServiceComment("");setDoneMessage("");setMapContext(await loadEmployeeRouteMapContext(selectedDate,crew));refresh()}catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be started.")}}''',
    '''  async function start(){
    if(!selected)return;
    try{
      if(selected.canonicalVisitId){
        await runVisitStatusOrQueue(selected.canonicalVisitId,"in_progress");
        setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"in_progress"));
      }else{
        startServiceSession(selected.id,profile.name,crew);
      }
      setCommentOpen(false);setServiceComment("");setDoneMessage("");refresh();
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be started.")}
  }''',
)

replace_once(
    "app/employee/route/page.tsx",
    '''  async function finish(){if(!selected)return;if(!window.confirm("Complete this house and mark it as Done?"))return;try{if(selected.canonicalVisitId)await runVisitStatusOrQueue(selected.canonicalVisitId,"completed");else finishServiceSession(selected.id,serviceComment);setDoneMessage("Done");setServiceComment("");setCommentOpen(false);setMapContext(await loadEmployeeRouteMapContext(selectedDate,crew));refresh();window.setTimeout(()=>{setDoneMessage("");setView("route")},850)}catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be completed.")}}''',
    '''  async function finish(){
    if(!selected)return;
    if(!window.confirm("Complete this house and mark it as Done?"))return;
    try{
      if(selected.canonicalVisitId){
        await runVisitStatusOrQueue(selected.canonicalVisitId,"completed");
        setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"completed"));
      }else{
        finishServiceSession(selected.id,serviceComment);
      }
      setDoneMessage("Done");setServiceComment("");setCommentOpen(false);refresh();window.setTimeout(()=>{setDoneMessage("");setView("route")},850);
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be completed.")}
  }''',
)

replace_once(
    "app/employee/route/page.tsx",
    '''  async function reset(){if(!selected)return;if(!window.confirm("Reset only this house? Status returns to Open across Admin, Dispatch and Employee Route."))return;try{if(selected.canonicalVisitId)await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");else resetServiceSession(selected.id);setDoneMessage("Reset to Open");setMapContext(await loadEmployeeRouteMapContext(selectedDate,crew));refresh()}catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be reset.")}}''',
    '''  async function reset(){
    if(!selected)return;
    if(!window.confirm("Reset only this house? Status returns to Open across Admin, Dispatch and Employee Route."))return;
    try{
      if(selected.canonicalVisitId){
        await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");
        setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"scheduled"));
      }else{
        resetServiceSession(selected.id);
      }
      setDoneMessage("Reset to Open");refresh();
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be reset.")}
  }''',
)

replace_once(
    "app/mobile/employee/page.tsx",
    'import { applyEmployeeDatabaseSmartRoute, applyEmployeeRouteMapContext, loadEmployeeDatabaseSmartRouteState, loadEmployeeRouteMapContext, restoreEmployeeDatabaseSmartRoute, type EmployeeDatabaseSmartRouteState, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";',
    'import { applyEmployeeDatabaseSmartRoute, applyEmployeeRouteMapContext, loadEmployeeDatabaseSmartRouteState, loadEmployeeRouteMapContext, loadEmployeeRouteMapContextUntilStatus, restoreEmployeeDatabaseSmartRoute, type EmployeeDatabaseSmartRouteState, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";',
)

replace_once(
    "app/mobile/employee/page.tsx",
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"in_progress");setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Service start saved offline. It will sync automatically.":"Service started and synchronized.")}else{startServiceSession(selected.id,profile.name,crew);setMessage("Service started and synchronized.")} setRouteReload(value=>value+1); refresh();}''',
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"in_progress");setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"in_progress"));setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Service start saved offline. It will sync automatically.":"Service started and synchronized.")}else{startServiceSession(selected.id,profile.name,crew);setMessage("Service started and synchronized.")} setRouteReload(value=>value+1); refresh();}''',
)

replace_once(
    "app/mobile/employee/page.tsx",
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"completed");setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Completion saved offline. It will sync automatically.":"Done. Every device was updated.")}else{finishServiceSession(selected.id,comment);setMessage("Done. Every device was updated.")} setRouteReload(value=>value+1); refresh();}''',
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"completed");setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"completed"));setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Completion saved offline. It will sync automatically.":"Done. Every device was updated.")}else{finishServiceSession(selected.id,comment);setMessage("Done. Every device was updated.")} setRouteReload(value=>value+1); refresh();}''',
)

replace_once(
    "app/mobile/employee/page.tsx",
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Reset saved offline. It will sync automatically.":"House reset to Open on every device.")}else{resetServiceSession(selected.id);setMessage("House reset to Open on every device.")} setComment(""); setRouteReload(value=>value+1); refresh();}''',
    '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"scheduled"));setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Reset saved offline. It will sync automatically.":"House reset to Open on every device.")}else{resetServiceSession(selected.id);setMessage("House reset to Open on every device.")} setComment(""); setRouteReload(value=>value+1); refresh();}''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    'const adminRoutes = await authRequest<any>(adminDesktop, "/api/admin/routes");',
    'const adminRoutes = await authRequest<any>(adminDesktop, `/api/admin/routes?date=${encodeURIComponent(routeDate)}`);',
)

replace_once(
    "lib/services/employeeVisitStatusService.ts",
    '''  const response = await fetch("/api/mobile/employee/route", {
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
  return result;''',
    '''  let lastError = "Visit could not reach the server.";
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
      if (response.ok) return result;
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
  throw new Error(`${lastError} No status was changed.`);''',
)

print("Canonical status convergence patch applied.")
