from pathlib import Path

# 1) Make canonical Visit timestamps/status win over stale local sessions and force quick syncs
mobile_path = Path('app/mobile/employee/page.tsx')
mobile = mobile_path.read_text()

old = '''  const seconds=useMemo(()=>{\n    if(!session){\n      if(selected?.visitDurationSeconds)return selected.visitDurationSeconds;\n      const started=selected?.visitStartedAt?new Date(selected.visitStartedAt).getTime():0;\n      const finished=selected?.visitFinishedAt?new Date(selected.visitFinishedAt).getTime():0;\n      if(started)return Math.max(0,Math.round(((finished||Date.now())-started)/1000));\n      return 0;\n    }\n    if(session.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));\n    return session.durationSeconds||0;\n  },[session,tick,selected?.visitDurationSeconds,selected?.visitStartedAt,selected?.visitFinishedAt]);'''
new = '''  const seconds=useMemo(()=>{\n    // Canonical Visit execution state is universal across Admin/web/mobile and must\n    // always win over legacy/local service sessions. The UI ticks locally from\n    // started_at so we never poll the database every second.\n    if(selected?.canonicalVisitId){\n      const started=selected.visitStartedAt?new Date(selected.visitStartedAt).getTime():0;\n      const finished=selected.visitFinishedAt?new Date(selected.visitFinishedAt).getTime():0;\n      if(selected.canonicalVisitStatus==="in_progress"&&started)return Math.max(0,Math.round((Date.now()-started)/1000));\n      if(selected.canonicalVisitStatus==="completed"){\n        if(selected.visitDurationSeconds)return selected.visitDurationSeconds;\n        if(started&&finished)return Math.max(0,Math.round((finished-started)/1000));\n      }\n      if(selected.canonicalVisitStatus==="scheduled"||selected.canonicalVisitStatus==="missed")return 0;\n    }\n    if(session?.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));\n    return session?.durationSeconds||0;\n  },[session,tick,selected?.canonicalVisitId,selected?.canonicalVisitStatus,selected?.visitDurationSeconds,selected?.visitStartedAt,selected?.visitFinishedAt]);'''
if old not in mobile:
    raise SystemExit('seconds anchor not found')
mobile = mobile.replace(old, new, 1)

old = '  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setContractOpen(true); setTab("service"); setMessage("")}\n'
new = '''  async function refreshCanonicalRouteNow(){\n    try{\n      const next=mapContext.routeId?await loadEmployeeRouteMapContextByRouteId(mapContext.routeId):await loadEmployeeRouteMapContext(selectedDate,crew);\n      setMapContext(next);setRouteReload(value=>value+1);setTick(value=>value+1);\n      return next;\n    }catch{return null}\n  }\n  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setContractOpen(true); setTab("service"); setMessage(""); void refreshCanonicalRouteNow()}\n'''
if old not in mobile:
    raise SystemExit('openService anchor not found')
mobile = mobile.replace(old, new, 1)

old = '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"in_progress");setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"in_progress"));setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Service start saved offline. It will sync automatically.":"Service started and synchronized.")}else{startServiceSession(selected.id,profile.name,crew);setMessage("Service started and synchronized.")} setRouteReload(value=>value+1); refresh();}'''
new = '''    try{if(selected.canonicalVisitId){const visitId=selected.canonicalVisitId;const result=await runVisitStatusOrQueue(visitId,"in_progress");const startedAt=String(result.visit?.started_at||result.visit?.startedAt||new Date().toISOString());setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{...stop,status:"in_progress",startedAt,finishedAt:undefined,durationSeconds:undefined}:stop)}));setTick(value=>value+1);setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Service start saved offline. It will sync automatically.":"Service started and synchronized.");void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"in_progress").then(setMapContext).catch(()=>void refreshCanonicalRouteNow())}else{startServiceSession(selected.id,profile.name,crew);setMessage("Service started and synchronized.")} setRouteReload(value=>value+1); refresh(false);}'''
if old not in mobile:
    raise SystemExit('start anchor not found')
mobile = mobile.replace(old, new, 1)

old = '''    try{if(selected.canonicalVisitId){const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"completed");setMapContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"completed"));setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Completion saved offline. It will sync automatically.":"Done. Every device was updated.")}else{finishServiceSession(selected.id,comment);setMessage("Done. Every device was updated.")} setRouteReload(value=>value+1); refresh();}'''
new = '''    try{if(selected.canonicalVisitId){const visitId=selected.canonicalVisitId;const result=await runVisitStatusOrQueue(visitId,"completed");const finishedAt=String(result.visit?.finished_at||result.visit?.finishedAt||new Date().toISOString());const durationSeconds=Number(result.visit?.duration_seconds||result.visit?.durationSeconds||seconds||0);setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{...stop,status:"completed",finishedAt,durationSeconds}:stop)}));setTick(value=>value+1);setOfflinePending(getOfflineActionCount());setMessage(result.queued?"Completion saved offline. It will sync automatically.":"Done. Every device was updated.");void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"completed").then(setMapContext).catch(()=>void refreshCanonicalRouteNow())}else{finishServiceSession(selected.id,comment);setMessage("Done. Every device was updated.")} setRouteReload(value=>value+1); refresh(false);}'''
if old not in mobile:
    raise SystemExit('finish anchor not found')
mobile = mobile.replace(old, new, 1)

old = '      <button type="button" className="employee-top-back" onClick={()=>{if(tab==="service")setTab("route");else if(tab==="task")setTab("issues");else if(tab==="profile")setTab("route");else window.history.back()}} aria-label="Go back">‹</button>'
new = '      <button type="button" className="employee-top-back" onClick={()=>{if(tab==="service"){setTab("route");void refreshCanonicalRouteNow()}else if(tab==="task")setTab("issues");else if(tab==="profile"){setTab("route");void refreshCanonicalRouteNow()}else window.history.back()}} aria-label="Go back">‹</button>'
if old not in mobile:
    raise SystemExit('top back anchor not found')
mobile = mobile.replace(old, new, 1)

old = '      <button className={tab==="route"||tab==="service"?"active":""} onClick={()=>setTab("route")}>Today&apos;s Route</button>'
new = '      <button className={tab==="route"||tab==="service"?"active":""} onClick={()=>{setTab("route");void refreshCanonicalRouteNow()}}>Today&apos;s Route</button>'
if old not in mobile:
    raise SystemExit('route tab anchor not found')
mobile = mobile.replace(old, new, 1)

mobile_path.write_text(mobile)

# 2) Broadcast successful canonical Visit changes instantly in the browser; Supabase Realtime handles other devices.
service_path = Path('lib/services/employeeVisitStatusService.ts')
service = service_path.read_text()
old = '      const result = await response.json().catch(() => ({}));\n      if (response.ok) return result;\n'
new = '''      const result = await response.json().catch(() => ({}));\n      if (response.ok) {\n        const routeId = String(result.visit?.route_id || result.visit?.routeId || "");\n        window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId, visitId, status: result.visit?.status || null } }));\n        if (typeof BroadcastChannel !== "undefined") {\n          const broadcast = new BroadcastChannel("damasio-canonical-route");\n          broadcast.postMessage({ routeId, visitId, status: result.visit?.status || null });\n          broadcast.close();\n        }\n        return result;\n      }\n'''
if old not in service:
    raise SystemExit('employeeVisitStatusService response anchor not found')
service_path.write_text(service.replace(old, new, 1))
