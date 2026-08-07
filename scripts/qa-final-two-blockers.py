from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Blocker 1: keep Exception Week reads on the existing company/job/date Visit index
# instead of a wide customer IN + tenant OR + database sort.
exceptions_path = Path("app/api/admin/operational-simulator/exceptions/route.ts")
text = exceptions_path.read_text()
text = replace_once(
    text,
    "  route_id: string | null;\n  scheduled_date: string;",
    "  route_id: string | null;\n  route_order: number | null;\n  scheduled_date: string;",
    "VisitRow route_order",
)
start = text.index("async function completedVisits(")
end = text.index("\n\nasync function exceptionStatus", start)
completed_visits = '''async function completedVisits(service: any, companyId: string, customerIds: string[]): Promise<VisitRow[]> {
  if (!customerIds.length) return [];

  // Simulation rows always carry company_id. Resolve their Jobs first so the
  // Visit lookup stays on the existing company/job/date index and avoids a
  // wide customer IN + tenant OR + database sort across the full Visits table.
  const jobs = await service.from("jobs")
    .select("id")
    .eq("company_id", companyId)
    .in("customer_id", customerIds);
  if (jobs.error) throw new Error(`jobs: ${jobs.error.message}`);
  const jobIds = (jobs.data || []).map((row: any) => String(row.id));
  if (!jobIds.length) return [];

  const rows: VisitRow[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 12) {
    const result = await service.from("visits")
      .select("id,customer_id,route_id,route_order,scheduled_date,status,started_at,finished_at,duration_seconds,employee_notes,customer_visible_summary")
      .eq("company_id", companyId)
      .in("job_id", jobIds.slice(offset, offset + 12))
      .eq("status", "completed")
      .limit(120);
    if (result.error) throw new Error(`visits: ${result.error.message}`);
    rows.push(...((result.data || []) as VisitRow[]));
  }

  return rows.sort((left, right) =>
    String(right.scheduled_date).localeCompare(String(left.scheduled_date))
    || Number(left.route_order ?? 2147483647) - Number(right.route_order ?? 2147483647)
    || left.id.localeCompare(right.id));
}'''
text = text[:start] + completed_visits + text[end:]
exceptions_path.write_text(text)


# Blocker 2: once the canonical writer returns the new route version, leave Smart
# Route preview immediately using the exact server-confirmed Visit order. The
# authoritative snapshot rehydrates asynchronously and can only replace this
# handoff with the same/newer version.
mobile_path = Path("app/mobile/employee/page.tsx")
text = mobile_path.read_text()
text = replace_once(
    text,
    '  useEffect(()=>{let cancelled=false;void loadEmployeeRouteMapContext(selectedDate,crew).then(context=>{if(!cancelled)setMapContext(context)});return()=>{cancelled=true}},[crew,selectedDate,routeReload]);',
    '  useEffect(()=>{let cancelled=false;void loadEmployeeRouteMapContext(selectedDate,crew).then(context=>{if(!cancelled)setMapContext(current=>current.routeId===context.routeId&&Number(current.routeVersion||0)>Number(context.routeVersion||0)?current:context)});return()=>{cancelled=true}},[crew,selectedDate,routeReload]);',
    "mobile canonical hydration monotonic guard",
)
old_block = '''      const reviewedVersion=activeSmartState&&"routeVersion" in activeSmartState?activeSmartState.routeVersion:mapContext.routeVersion;
      const appliedVersion=await applyEmployeeDatabaseSmartRoute({routeId:mapContext.routeId,originalOrder,appliedOrder,origin:smartOriginPoint,expectedVersion:reviewedVersion});
      let nextContext=await loadEmployeeRouteMapContextByRouteId(mapContext.routeId);
      for(let attempt=0;attempt<6&&Number(nextContext.routeVersion||0)<appliedVersion;attempt+=1){await new Promise(resolve=>window.setTimeout(resolve,250+attempt*150));nextContext=await loadEmployeeRouteMapContextByRouteId(mapContext.routeId)}
      if(Number(nextContext.routeVersion||0)<appliedVersion){window.location.reload();return}
      setMapContext(nextContext);
      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId: mapContext.routeId, routeVersion: nextContext.routeVersion } }));
      setSmartPreview([]);setHomeMode("route");setRouteView("map");refresh(false);setMessage("Smart Route applied. Admin and Employee now share the same published order.");
      // The canonical Route is already saved and visible. Secondary Smart Route state
      // must never hold the field UI on a stale preview while other screens advance.
      void loadEmployeeDatabaseSmartRouteState(mapContext.routeId).then(state=>{
        setActiveSmartState(state);setSmartRouteActive(Boolean(state?.active));
      }).catch(()=>{
        // Realtime/route snapshot remains authoritative; state can retry on the normal refresh cycle.
      });'''
new_block = '''      const reviewedVersion=activeSmartState&&"routeVersion" in activeSmartState?activeSmartState.routeVersion:mapContext.routeVersion;
      const routeId=mapContext.routeId;
      const appliedVersion=await applyEmployeeDatabaseSmartRoute({routeId,originalOrder,appliedOrder,origin:smartOriginPoint,expectedVersion:reviewedVersion});

      // The canonical writer has already committed this version and exact Visit order.
      // Leave preview mode immediately from that confirmed result instead of making the
      // field UI wait for a second read of the same snapshot to converge.
      const stopByVisitId=new Map(mapContext.stops.map(stop=>[stop.visitId,stop]));
      const publishedStops=appliedOrder.map((visitId,index)=>{const stop=stopByVisitId.get(visitId);return stop?{...stop,routeOrder:index+1}:null}).filter((stop):stop is EmployeeRouteMapContext["stops"][number]=>Boolean(stop));
      const publishedContext:EmployeeRouteMapContext={
        ...mapContext,
        routeId,
        routeVersion:appliedVersion,
        orderedVisitIds:[...appliedOrder],
        routeOrder:appliedOrder.map((visitId,index)=>({visitId,routeOrder:index+1})),
        geometry:null,
        stops:publishedStops.length===mapContext.stops.length?publishedStops:mapContext.stops,
      };
      setMapContext(publishedContext);
      setSmartPreview([]);setHomeMode("route");setRouteView("map");
      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId, routeVersion: appliedVersion } }));
      refresh(false);setMessage("Smart Route applied. Admin and Employee now share the same published order.");

      // Rehydrate from the authoritative canonical snapshot without holding the published
      // UI in preview. A slower older read may not replace the writer-confirmed version.
      void (async()=>{
        let nextContext=await loadEmployeeRouteMapContextByRouteId(routeId);
        for(let attempt=0;attempt<6&&Number(nextContext.routeVersion||0)<appliedVersion;attempt+=1){await new Promise(resolve=>window.setTimeout(resolve,250+attempt*150));nextContext=await loadEmployeeRouteMapContextByRouteId(routeId)}
        if(Number(nextContext.routeVersion||0)>=appliedVersion){
          setMapContext(current=>current.routeId===nextContext.routeId&&Number(current.routeVersion||0)>Number(nextContext.routeVersion||0)?current:nextContext);
          window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId, routeVersion: nextContext.routeVersion } }));
        }
      })().catch(()=>{
        // The confirmed writer state remains visible; realtime and normal refresh can retry.
      });

      // Secondary Smart Route state is also non-blocking after the canonical writer succeeds.
      void loadEmployeeDatabaseSmartRouteState(routeId).then(state=>{
        setActiveSmartState(state);setSmartRouteActive(Boolean(state?.active));
      }).catch(()=>{
        // Realtime/route snapshot remains authoritative; state can retry on the normal refresh cycle.
      });'''
text = replace_once(text, old_block, new_block, "applySmartPreview confirmed-write handoff")
mobile_path.write_text(text)

print("Final two blocker candidates applied.")
