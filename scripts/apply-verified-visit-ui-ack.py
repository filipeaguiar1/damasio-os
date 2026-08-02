from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "lib/mobile/offlineActionQueue.ts",
    '''  try {
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
  return { queued: false };''',
    '''  let result: Record<string, any> | null = null;
  try {
    result = await changeEmployeeVisitStatus(visitId, status, resolvedReason || undefined) as Record<string, any>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (status !== "scheduled" || !/completed.*reopen|requires reopen/i.test(message)) throw error;

    const confirmation = window.prompt(
      "This Visit is completed. Employee Reopen is allowed only for your own Visit today, within 15 minutes and before Task, feedback or financial processing. Type REOPEN to continue.",
    );
    if (confirmation?.trim().toUpperCase() !== "REOPEN") {
      throw new Error("Completed Visit Reopen cancelled.");
    }
    result = await reopenEmployeeCompletedVisit(visitId, resolvedReason) as Record<string, any>;
  }
  return { queued: false, ...(result || {}) };''',
)

replace_once(
    "app/employee/route/page.tsx",
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
    '''  async function start(){
    if(!selected)return;
    try{
      if(selected.canonicalVisitId){
        const visitId=selected.canonicalVisitId;
        const transition=await runVisitStatusOrQueue(visitId,"in_progress") as {visit?:{status?:string;started_at?:string|null;finished_at?:string|null;duration_seconds?:number|null}};
        const verified=transition.visit;
        if(verified?.status!=="in_progress"||!verified.started_at||verified.finished_at){
          throw new Error("The server did not confirm this Visit as active.");
        }
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          status:"in_progress",
          startedAt:verified.started_at||undefined,
          finishedAt:undefined,
          durationSeconds:undefined,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"in_progress")
          .then(setMapContext)
          .catch(error=>setMenuMessage(error instanceof Error?error.message:"The active Visit could not be refreshed."));
      }else{
        startServiceSession(selected.id,profile.name,crew);
      }
      setCommentOpen(false);setServiceComment("");setDoneMessage("");refresh();
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be started.")}
  }''',
)

replace_once(
    "app/employee/route/page.tsx",
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
    '''  async function finish(){
    if(!selected)return;
    if(!window.confirm("Complete this house and mark it as Done?"))return;
    try{
      if(selected.canonicalVisitId){
        const visitId=selected.canonicalVisitId;
        const transition=await runVisitStatusOrQueue(visitId,"completed") as {visit?:{status?:string;started_at?:string|null;finished_at?:string|null;duration_seconds?:number|null}};
        const verified=transition.visit;
        if(verified?.status!=="completed"||!verified.started_at||!verified.finished_at||!Number.isFinite(Number(verified.duration_seconds))){
          throw new Error("The server did not confirm this Visit as completed.");
        }
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          status:"completed",
          startedAt:verified.started_at||undefined,
          finishedAt:verified.finished_at||undefined,
          durationSeconds:Number(verified.duration_seconds),
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"completed")
          .then(setMapContext)
          .catch(error=>setMenuMessage(error instanceof Error?error.message:"The completed Visit could not be refreshed."));
      }else{
        finishServiceSession(selected.id,serviceComment);
      }
      setDoneMessage("Done");setServiceComment("");setCommentOpen(false);refresh();window.setTimeout(()=>{setDoneMessage("");setView("route")},850);
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be completed.")}
  }''',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''          const genericBadRequest = response.status === 400
            && /^bad request$/i.test(String(result?.error || ""));''',
    '''          const genericBadRequest = [400, 401].includes(response.status)
            && /^bad request$/i.test(String(result?.error || ""));''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /^HTTP_400:Bad Request$/i.test(lastError);''',
    '''      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /^HTTP_(400|401):Bad Request$/i.test(lastError);''',
)

print("Verified Visit UI acknowledgement and generic auth retry patch applied.")
