from pathlib import Path

strong = Path('app/api/map/canonical-route-strong/route.ts')
text = strong.read_text()
old = '''    const stopById = new Map(snapshot.stops.map(stop => [String(stop.visitId), stop]));
    const stops = orderedVisitIds.map((visitId, index) => ({
      ...stopById.get(visitId)!,
      routeOrder: index + 1,
    }));
'''
new = '''    // Route order/membership and Visit execution change on different clocks.
    // Always read execution state directly with the uncached service client so a
    // Start/Finish/Reset is visible even when routeVersion itself did not change.
    const executionResult = await service
      .from("visits")
      .select("id,status,scheduled_date,started_at,finished_at,duration_seconds")
      .in("id", orderedVisitIds);
    if (executionResult.error) throw new Error(executionResult.error.message);
    const executionById = new Map<string, any>(
      (executionResult.data || []).map((row: any) => [String(row.id), row]),
    );
    if (executionById.size !== orderedVisitIds.length) {
      throw new Error("Canonical Visit execution state is incomplete for this Route.");
    }

    const stopById = new Map(snapshot.stops.map(stop => [String(stop.visitId), stop]));
    const stops = orderedVisitIds.map((visitId, index) => {
      const stop = stopById.get(visitId)!;
      const execution = executionById.get(visitId)!;
      return {
        ...stop,
        routeOrder: index + 1,
        status: String(execution.status || stop.status || "scheduled"),
        scheduledDate: execution.scheduled_date || (stop as any).scheduledDate,
        startedAt: execution.started_at,
        finishedAt: execution.finished_at,
        durationSeconds: execution.duration_seconds,
      };
    });
'''
if new not in text:
    if old not in text:
        raise SystemExit('strong snapshot anchor not found')
    text = text.replace(old, new, 1)

log_old = '''      serviceOverride: orderChanged || originChanged,
      stopCount: stops.length,
      geometryStatus,
'''
log_new = '''      serviceOverride: orderChanged || originChanged,
      freshExecutionCount: executionById.size,
      stopCount: stops.length,
      geometryStatus,
'''
if log_new not in text:
    if log_old not in text:
        raise SystemExit('strong snapshot log anchor not found')
    text = text.replace(log_old, log_new, 1)
strong.write_text(text)

mobile = Path('app/mobile/employee/page.tsx')
text = mobile.read_text()
anchor = '''  const session=selected?getSessionForLead(selected.id):null;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
'''
insert = '''  const session=selected?getSessionForLead(selected.id):null;
  const canonicalStatus=selected?.canonicalVisitStatus;
  const canonicalScheduled=Boolean(selected?.canonicalVisitId)&&canonicalStatus==="scheduled";
  const canonicalActive=Boolean(selected?.canonicalVisitId)&&canonicalStatus==="in_progress";
  const canonicalDone=Boolean(selected?.canonicalVisitId)&&canonicalStatus==="completed";
  const canonicalMissed=Boolean(selected?.canonicalVisitId)&&canonicalStatus==="missed";
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
'''
if insert not in text:
    if anchor not in text:
        raise SystemExit('mobile canonical status anchor not found')
    text = text.replace(anchor, insert, 1)

replacements = {
'''<b className={selected.status==="completed"?"mobile-status done":session?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(selected,session)}</b>''':
'''<b className={canonicalDone?"mobile-status done":canonicalMissed||session?.status==="skipped"?"mobile-status skipped":canonicalActive?"mobile-status in-progress":"mobile-status"}>{statusLabel(selected,session)}</b>''',
'''<div><span>Started</span><strong>{timeLabel(session?.startedAt||selected.visitStartedAt)}</strong></div>''':
'''<div><span>Started</span><strong>{timeLabel(selected.canonicalVisitId?selected.visitStartedAt:session?.startedAt)}</strong></div>''',
'''<div><span>Finished</span><strong>{timeLabel(session?.finishedAt||selected.visitFinishedAt)}</strong></div>''':
'''<div><span>Finished</span><strong>{timeLabel(selected.canonicalVisitId?selected.visitFinishedAt:session?.finishedAt)}</strong></div>''',
'''<button className="mobile-primary" disabled={busy||session?.status==="running"||selected.status==="completed"} onClick={start}>Start</button>''':
'''<button className="mobile-primary" disabled={busy||(selected.canonicalVisitId?!canonicalScheduled:session?.status==="running"||selected.status==="completed")} onClick={start}>Start</button>''',
'''<button className="mobile-finish" disabled={busy||(!selected.canonicalVisitId&&session?.status!=="running")||(Boolean(selected.canonicalVisitId)&&!selected.visitStartedAt)||selected.status==="completed"} onClick={finish}>Finish</button>''':
'''<button className="mobile-finish" disabled={busy||(selected.canonicalVisitId?!canonicalActive:session?.status!=="running")} onClick={finish}>Finish</button>''',
'''<button className="mobile-reset" disabled={busy||(!session&&!selected.canonicalVisitId&&selected.status!=="completed")} onClick={reset}>Reset</button>''':
'''<button className="mobile-reset" disabled={busy||(selected.canonicalVisitId?!(canonicalScheduled||canonicalActive):(!session&&selected.status!=="completed"))} onClick={reset}>Reset</button>''',
'''<button className="mobile-skip" disabled={busy||selected.status==="completed"} onClick={openSkip}>Skip</button>''':
'''<button className="mobile-skip" disabled={busy||(selected.canonicalVisitId?(canonicalDone||canonicalMissed):selected.status==="completed")} onClick={openSkip}>Skip</button>''',
}
for old_text, new_text in replacements.items():
    if new_text in text:
        continue
    if old_text not in text:
        raise SystemExit(f'mobile replacement anchor missing: {old_text[:80]}')
    text = text.replace(old_text, new_text, 1)
mobile.write_text(text)

print('canonical execution live patch applied')
