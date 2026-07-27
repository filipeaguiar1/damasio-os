from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Missing expected text in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, count))


def sub(path: str, pattern: str, replacement: str, count: int = 1) -> None:
    text = read(path)
    updated, found = re.subn(pattern, replacement, text, count=count, flags=re.S)
    if found != count:
        raise RuntimeError(f"Expected {count} match(es) in {path}, found {found}: {pattern[:120]!r}")
    write(path, updated)


# Preserve the real visit status on every canonical route lead.
path = "lib/services/schedulingService.ts"
text = read(path)
if "canonicalVisitStatus: visit.status" not in text:
    text = text.replace(
        "      canonicalCrewId: visit.crewId || undefined,\n      visitStartedAt: visit.startedAt || undefined,",
        "      canonicalCrewId: visit.crewId || undefined,\n      canonicalVisitStatus: visit.status,\n      visitStartedAt: visit.startedAt || undefined,",
        1,
    )
write(path, text)

path = "lib/services/routeMapService.ts"
text = read(path)
if "canonicalVisitStatus: stop.status" not in text:
    text = text.replace(
        "      canonicalVisitId: stop.visitId,\n      visitStartedAt: stop.startedAt || lead?.visitStartedAt,",
        "      canonicalVisitId: stop.visitId,\n      canonicalVisitStatus: stop.status as any,\n      visitStartedAt: stop.startedAt || lead?.visitStartedAt,",
        1,
    )
write(path, text)

# Employee map: grey pending, green complete, yellow skipped; always locate houses.
path = "components/mobile/EmployeeRouteMap.tsx"
text = read(path)
text = re.sub(
    r"function visualState\(lead: CanonicalRouteLead, isNext: boolean\) \{.*?\n\}\n\nexport function EmployeeRouteMap",
    '''function visualState(lead: CanonicalRouteLead, _isNext: boolean) {
  const canonicalStatus = lead.canonicalVisitStatus;
  if (canonicalStatus === "completed" || lead.status === "completed") return { color: "#16a34a", label: "Completed" };
  if (canonicalStatus === "missed") return { color: "#eab308", label: "Skipped" };

  const session = getSessionForLead(lead.id);
  if (session?.status === "skipped") return { color: "#eab308", label: "Skipped" };
  if (session?.status === "finished") return { color: "#16a34a", label: "Completed" };
  return { color: "#64748b", label: "Pending" };
}

export function EmployeeRouteMap''',
    text,
    count=1,
    flags=re.S,
)
text = re.sub(
    r'const routeKey = route\.map\(lead => `\$\{lead\.id\}:\$\{lead\.address\}:\$\{lead\.routeOrder \?\? ""\}`\)\.join\("\|"\);',
    'const routeKey = route.map(lead => `${lead.id}:${lead.address}:${lead.routeOrder ?? ""}:${lead.canonicalVisitStatus || lead.status}`).join("|");',
    text,
    count=1,
)
text = text.replace("\n      if (routeId) return;\n", "\n", 1)
text = re.sub(
    r"  useEffect\(\(\) => \{\n    let cancelled = false;\n    if \(!routeId\) return \(\) => \{ cancelled = true; \};\n\n    loadCachedRouteGeometry\(routeId\).*?\n  \}, \[routeId\]\);",
    '''  useEffect(() => {
    let cancelled = false;
    if (!routeId) return () => { cancelled = true; };

    loadCachedRouteGeometry(routeId)
      .then(cache => {
        if (cancelled) return;
        if (cache?.status === "ready" && cache.geometry) {
          setGeometry(cache.geometry);
          setMapStatus("Driving route");
        }
      })
      .catch(() => { /* direct road calculation remains the fallback */ });

    return () => { cancelled = true; };
  }, [routeId]);''',
    text,
    count=1,
    flags=re.S,
)
if ".bindTooltip(`${point.name} · ${point.label}`" not in text:
    text = re.sub(
        r'(L\.marker\(\[point\.latitude, point\.longitude\], \{ icon \}\)\n)(\s*\.on\("click", \(\) => setSelectedId\(point\.id\)\))',
        r'\1          .bindTooltip(`${point.name} · ${point.label}`, { direction: "top" })\n\2',
        text,
        count=1,
    )
write(path, text)

# Canonical Employee endpoint supports all field actions without the missing map RPC.
path = "app/api/mobile/employee/route/route.ts"
text = read(path)
text = text.replace(
    '      action?: "start" | "done" | "note";',
    '      action?: "start" | "done" | "reset" | "skip" | "note";',
    1,
)
text = re.sub(
    r'''    if \(body\.action === "start"\) \{.*?    \} else \{\n      throw new Error\("Choose a valid visit action\."\);\n    \}''',
    '''    if (body.action === "start") {
      if (["completed", "cancelled", "missed"].includes(visit.status)) throw new Error("This visit can no longer be started.");
      patch.status = "in_progress";
      patch.started_at = visit.started_at || now.toISOString();
      patch.finished_at = null;
      patch.duration_seconds = null;
    } else if (body.action === "done") {
      if (["cancelled", "missed"].includes(visit.status)) throw new Error("This visit cannot be completed.");
      const startedAt = visit.started_at ? new Date(visit.started_at).getTime() : now.getTime();
      patch.status = "completed";
      patch.started_at = visit.started_at || now.toISOString();
      patch.finished_at = now.toISOString();
      patch.duration_seconds = Math.max(0, Math.round((now.getTime() - startedAt) / 1000));
    } else if (body.action === "reset") {
      patch.status = "scheduled";
      patch.started_at = null;
      patch.finished_at = null;
      patch.duration_seconds = null;
    } else if (body.action === "skip") {
      if (["completed", "cancelled"].includes(visit.status)) throw new Error("This visit can no longer be skipped.");
      patch.status = "missed";
      patch.finished_at = now.toISOString();
    } else {
      throw new Error("Choose a valid visit action.");
    }''',
    text,
    count=1,
    flags=re.S,
)
write(path, text)

# Mobile Employee: no demo seed, automatic official origin, canonical skip.
path = "app/mobile/employee/page.tsx"
text = read(path)
text = text.replace("  seedDemoLeads,\n", "")
text = text.replace("      seedDemoLeads();\n", "")
if "defaultOriginPoint" not in text:
    text = text.replace(
        '  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});',
        '  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});\n  const [routeStartAddress,setRouteStartAddress]=useState("");\n  const [defaultOriginPoint,setDefaultOriginPoint]=useState<{latitude:number;longitude:number;label:string}|null>(null);',
        1,
    )
text = text.replace(
    'void loadEmployeeOperationalIdentity().then(identity=>setCrew(identity.crew));',
    'void loadEmployeeOperationalIdentity().then(identity=>{setCrew(identity.crew);setRouteStartAddress(identity.routeStartAddress||"")});',
    1,
)
if "setDefaultOriginPoint" in text and "geocodeAddress(routeStartAddress)" not in text:
    anchor = '  useEffect(()=>{let cancelled=false;void loadEmployeeRouteMapContext(selectedDate,crew).then(context=>{if(!cancelled)setMapContext(context)});return()=>{cancelled=true}},[crew,selectedDate,routeReload]);'
    text = text.replace(
        anchor,
        anchor + '\n  useEffect(()=>{let cancelled=false;if(!routeStartAddress){setDefaultOriginPoint(null);return()=>{cancelled=true}}void geocodeAddress(routeStartAddress).then(point=>{if(!cancelled)setDefaultOriginPoint({...point,label:`${profile.name||"Employee"} start`})}).catch(()=>{if(!cancelled)setDefaultOriginPoint(null)});return()=>{cancelled=true}},[routeStartAddress,profile.name]);',
        1,
    )
text = re.sub(
    r"  function confirmSkip\(\)\{.*?\n  \}",
    '''  async function confirmSkip(){
    if(!selected||busy)return;
    setBusy(true); setError("");
    try{
      if(selected.canonicalVisitId){await runVisitStatusOrQueue(selected.canonicalVisitId,"missed");setOfflinePending(getOfflineActionCount())}
      skipServiceSession(selected.id,skipComment,skipPhotos,profile.name,crew);
      setSkipOpen(false);setRouteReload(value=>value+1);refresh();setMessage("House skipped. Admin and Dispatch were notified.");setTab("route")
    }catch(error){setError(error instanceof Error?error.message:"House could not be skipped.")}
    finally{setBusy(false)}
  }''',
    text,
    count=1,
    flags=re.S,
)
text = text.replace('catch{setError("Service could not be started. Please try again.")}', 'catch(error){setError(error instanceof Error?error.message:"Service could not be started. Please try again.")}')
text = text.replace('catch{setError("Service could not be completed. Please try again.")}', 'catch(error){setError(error instanceof Error?error.message:"Service could not be completed. Please try again.")}')
text = text.replace(
    'originPoint={smartRouteActive&&activeSmartState&&Number.isFinite(activeSmartState.originLatitude)&&Number.isFinite(activeSmartState.originLongitude)?{latitude:Number(activeSmartState.originLatitude),longitude:Number(activeSmartState.originLongitude),label:activeSmartState.originLabel}:null}',
    'originPoint={smartRouteActive&&activeSmartState&&Number.isFinite(activeSmartState.originLatitude)&&Number.isFinite(activeSmartState.originLongitude)?{latitude:Number(activeSmartState.originLatitude),longitude:Number(activeSmartState.originLongitude),label:activeSmartState.originLabel}:defaultOriginPoint}',
    1,
)
write(path, text)

# Browser Employee route: canonical timer/actions, origin and no demo buttons.
path = "app/employee/route/page.tsx"
text = read(path)
text = text.replace('import {changeVisitStatus} from "@/lib/services/schedulingService";', 'import {runVisitStatusOrQueue} from "@/lib/mobile/offlineActionQueue";', 1)
text = text.replace("  seedDemoLeads,\n", "")
text = text.replace("  seedEmployeeTasks,\n", "")
if "routeOrigin" not in text:
    text = text.replace(
        '  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});',
        '  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});\n  const [routeStartAddress,setRouteStartAddress]=useState("");\n  const [routeOrigin,setRouteOrigin]=useState<{latitude:number;longitude:number;label:string}|null>(null);',
        1,
    )
text = text.replace(
    'void loadEmployeeOperationalIdentity().then(identity=>setCrew(identity.crew));',
    'void loadEmployeeOperationalIdentity().then(identity=>{setCrew(identity.crew);setRouteStartAddress(identity.routeStartAddress||"")});',
    1,
)
if "setRouteOrigin" in text and "encodeURIComponent(routeStartAddress)" not in text:
    anchor = '  useEffect(()=>{let cancelled=false;if(!selectedDate||!crew)return;void loadEmployeeRouteMapContext(selectedDate,crew).then(context=>{if(!cancelled)setMapContext(context)});return()=>{cancelled=true}},[selectedDate,crew]);'
    text = text.replace(
        anchor,
        anchor + '\n  useEffect(()=>{let cancelled=false;if(!routeStartAddress){setRouteOrigin(null);return()=>{cancelled=true}}void fetch(`/api/map/geocode?address=${encodeURIComponent(routeStartAddress)}`,{cache:"no-store"}).then(response=>{if(!response.ok)throw new Error("not mapped");return response.json()}).then((point:{latitude:number;longitude:number})=>{if(!cancelled)setRouteOrigin({...point,label:`${profile.name||"Employee"} start`})}).catch(()=>{if(!cancelled)setRouteOrigin(null)});return()=>{cancelled=true}},[routeStartAddress,profile.name]);',
        1,
    )
text = re.sub(r"\n  function loadDemo\(\)\{.*?\n  \}\n", "\n", text, count=1, flags=re.S)
text = re.sub(
    r"  const runningSeconds=useMemo\(\(\)=>\{.*?\n  \},\[session,tick\]\);",
    '''  const runningSeconds=useMemo(()=>{
    if(selected?.canonicalVisitId){
      if(selected.visitDurationSeconds)return selected.visitDurationSeconds;
      const started=selected.visitStartedAt?new Date(selected.visitStartedAt).getTime():0;
      const finished=selected.visitFinishedAt?new Date(selected.visitFinishedAt).getTime():0;
      if(started)return Math.max(0,Math.round(((finished||Date.now())-started)/1000));
      return 0;
    }
    if(!session)return 0;
    if(session.durationSeconds)return session.durationSeconds;
    if(session.startedAt&&session.status==="running")return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return 0;
  },[session,tick,selected?.canonicalVisitId,selected?.visitDurationSeconds,selected?.visitStartedAt,selected?.visitFinishedAt]);''',
    text,
    count=1,
    flags=re.S,
)
text = text.replace("changeVisitStatus(selected.canonicalVisitId", "runVisitStatusOrQueue(selected.canonicalVisitId")
text = text.replace('{openTasks.length===0&&tasks.length===0&&<button className="btn btn-primary" onClick={loadDemo}>Load Demo Tasks</button>}', "")
text = text.replace('<button className="btn btn-primary" onClick={loadDemo}>Load Demo Route</button>', "")
text = text.replace(
    'const state=attention?"attention":leadSession?.status==="skipped"?"skipped":lead.status==="completed"?"completed":lead.id===nextId?"next":"pending";',
    'const state=lead.canonicalVisitStatus==="missed"||leadSession?.status==="skipped"?"skipped":lead.canonicalVisitStatus==="completed"||lead.status==="completed"?"completed":"pending";',
    1,
)
text = text.replace(
    '<EmployeeRouteMap route={mapRouteLeads} routeId={mapContext.routeId||undefined} onOpenVisit={openLead} desktop />',
    '<EmployeeRouteMap route={mapRouteLeads} routeId={mapContext.routeId||undefined} originPoint={routeOrigin} onOpenVisit={openLead} desktop />',
    1,
)
text = re.sub(
    r'''        <div className=\{session\?\.status==="running"\?.*?        </div>\n      </div>''',
    '''        <div className={(selected.canonicalVisitStatus==="in_progress"||session?.status==="running")?"timer-status running":(selected.canonicalVisitStatus==="completed"||session?.status==="finished")?"timer-status finished":"timer-status"}>{selected.canonicalVisitStatus==="in_progress"||session?.status==="running"?"IN PROGRESS":selected.canonicalVisitStatus==="completed"||session?.status==="finished"?"DONE":selected.canonicalVisitStatus==="missed"?"SKIPPED":"NOT STARTED"}</div>
        <div className="timer-big">{formatDuration(runningSeconds)}</div>
        <div className="timer-grid">
          <div className="timer-box"><div className="timer-label">Started</div><div className="timer-value">{formatClock(selected.canonicalVisitId?selected.visitStartedAt:session?.startedAt)}</div></div>
          <div className="timer-box"><div className="timer-label">Finished</div><div className="timer-value">{formatClock(selected.canonicalVisitId?selected.visitFinishedAt:session?.finishedAt)}</div></div>
        </div>
      </div>''',
    text,
    count=1,
    flags=re.S,
)
text = text.replace(
    '<button className="start-btn" onClick={start} disabled={session?.status==="running"}>Start</button>',
    '<button className="start-btn" onClick={start} disabled={selected.canonicalVisitId?selected.canonicalVisitStatus==="in_progress"||selected.canonicalVisitStatus==="completed"||selected.canonicalVisitStatus==="missed":session?.status==="running"}>Start</button>',
    1,
)
text = text.replace(
    '<button className="finish-btn" onClick={finish} disabled={!session||session.status==="finished"}>Finish</button>',
    '<button className="finish-btn" onClick={finish} disabled={selected.canonicalVisitId?selected.canonicalVisitStatus!=="in_progress":!session||session.status==="finished"}>Finish</button>',
    1,
)
write(path, text)

# Admin Route Plan opens the real worker map first.
path = "components/admin/RouteStudio.tsx"
text = read(path)
if "OfficialRoutePlanMap" not in text:
    text = text.replace(
        'import { CustomerPropertyModal } from "@/components/property/CustomerPropertyModal";',
        'import { CustomerPropertyModal } from "@/components/property/CustomerPropertyModal";\nimport { OfficialRoutePlanMap } from "@/components/admin/OfficialRoutePlanMap";',
        1,
    )
text = re.sub(
    r'''    \{mode === "view" && !employee && <EmployeeDirectory.*?    /\>}''',
    '    {mode === "view" && !employee && <OfficialRoutePlanMap />}',
    text,
    count=1,
    flags=re.S,
)
write(path, text)

# Dashboard route plan and route status use official data only.
path = "app/admin/page.tsx"
text = read(path)
if "OfficialRoutePlanMap" not in text:
    text = text.replace(
        'import { AdminShell } from "@/components/admin/AdminShell";',
        'import { AdminShell } from "@/components/admin/AdminShell";\nimport { OfficialRoutePlanMap } from "@/components/admin/OfficialRoutePlanMap";\nimport { OfficialRouteStatus } from "@/components/admin/OfficialRouteStatus";',
        1,
    )
text = text.replace("    seedDemoLeads();\n    seedDemoEstimates();\n    seedDemoExpenses();\n    seedDemoRequests();\n", "")
text = re.sub(
    r'''        <article className="studio-panel route-map-panel">.*?</article>\n\n        <article className="studio-panel route-timeline-panel">''',
    '''        <OfficialRoutePlanMap />

        <article className="studio-panel route-timeline-panel">''',
    text,
    count=1,
    flags=re.S,
)
text = re.sub(
    r'''        <article className="studio-panel route-status-panel">.*?</article>\n\n        <article className="studio-panel recent-activity-panel">''',
    '''        <OfficialRouteStatus />

        <article className="studio-panel recent-activity-panel">''',
    text,
    count=1,
    flags=re.S,
)
write(path, text)

print("Official route patch applied.")
