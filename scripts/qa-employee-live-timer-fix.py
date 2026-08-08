from pathlib import Path

mobile_path = Path('app/mobile/employee/page.tsx')
mobile = mobile_path.read_text()
old = 'function statusLabel(lead:Lead, session?:ReturnType<typeof getSessionForLead>){return lead.status==="completed"?"Done":session?.status==="skipped"?"Skipped":"Open"}'
new = 'function statusLabel(lead:Lead, session?:ReturnType<typeof getSessionForLead>){const canonical=(lead as Lead&{canonicalVisitStatus?:string}).canonicalVisitStatus;return canonical==="completed"||lead.status==="completed"?"Done":canonical==="missed"||session?.status==="skipped"?"Skipped":canonical==="in_progress"?"In progress":"Open"}'
if old in mobile:
    mobile = mobile.replace(old, new, 1)
elif new not in mobile:
    raise SystemExit('mobile statusLabel anchor not found')

old = 'setSelectedId(current=>current&&rows.some(row=>row.id===current)?current:(rows[0]?.id||""));'
new = 'setSelectedId(current=>current||(rows[0]?.id||""));'
if old in mobile:
    mobile = mobile.replace(old, new, 1)
elif new not in mobile:
    raise SystemExit('mobile selectedId refresh anchor not found')

old = 'const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");'
new = 'const result=await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled",selected.canonicalVisitStatus==="scheduled"?"Employee cleared an Open Visit timer.":undefined);'
if old in mobile:
    mobile = mobile.replace(old, new, 1)
elif new not in mobile:
    raise SystemExit('mobile reset anchor not found')
mobile_path.write_text(mobile)

map_path = Path('components/mobile/EmployeeRouteMap.tsx')
map_text = map_path.read_text()
map_text = map_text.replace('return { color: "#2563eb", label: "Active" };', 'return { color: "#2563eb", label: "In progress" };')
map_text = map_text.replace('if (lead.canonicalVisitStatus === "in_progress") return "Active";', 'if (lead.canonicalVisitStatus === "in_progress") return "In progress";')
map_path.write_text(map_text)

api_path = Path('app/api/mobile/employee/route/route.ts')
api = api_path.read_text()
anchor = '''    const reason = String(body.reason || "").trim();
    if (["reset", "reopen"].includes(action) && reason.length < 5) {
      throw new Error(`${action === "reset" ? "Reset" : "Reopen"} requires a reason with at least 5 characters.`);
    }

    const result = await user.rpc("transition_visit_execution", {'''
replacement = '''    const reason = String(body.reason || "").trim();
    if (["reset", "reopen"].includes(action) && reason.length < 5) {
      throw new Error(`${action === "reset" ? "Reset" : "Reopen"} requires a reason with at least 5 characters.`);
    }

    // Reset is intentionally idempotent for an Open Visit. This lets the field app
    // clear a stale/local timer safely without creating a fake execution transition.
    if (action === "reset") {
      const currentReset = await service
        .from("visits")
        .select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds,route_id,route_order")
        .eq("id", visitId)
        .or(companyFilter(companyId))
        .maybeSingle();
      if (currentReset.error) throw new Error(currentReset.error.message);
      const currentVisit = currentReset.data;
      if (!currentVisit) throw new Error("Visit not found in this company.");
      const assigned = currentVisit.assigned_employee_id === employee.id
        || (!currentVisit.assigned_employee_id && Boolean(employee.crew_id) && currentVisit.crew_id === employee.crew_id);
      if (!assigned) throw new Error("This Visit is not assigned to the authenticated Employee.");
      if (currentVisit.status === "scheduled") {
        const repaired = await fallbackVisitTransition({ service, employee, userId, companyId, visitId, action, reason });
        return NextResponse.json({ visit: repaired, fallback: true, verified: true, idempotent: true });
      }
    }

    const result = await user.rpc("transition_visit_execution", {'''
if anchor in api:
    api = api.replace(anchor, replacement, 1)
elif 'idempotent: true' not in api:
    raise SystemExit('employee route reset anchor not found')
api_path.write_text(api)

test_path = Path('tests/full-ecosystem-smart-route.spec.ts')
test = test_path.read_text()
anchor = '''    expect((afterRelaunch.stops || []).map((stop: any) => String(stop.visitId))).toEqual(reversed);

    const audit = await service.from("route_order_audit").select("route_id,source,next_order,route_version")'''
addition = '''    expect((afterRelaunch.stops || []).map((stop: any) => String(stop.visitId))).toEqual(reversed);

    // Regression: a single Employee may legitimately have multiple active Visits
    // at the same time. Each Visit owns its own independent timer.
    for (const activeVisitId of reversed.slice(0, 2)) {
      await bodyOf(await request.patch(`${appUrl}/api/mobile/employee/route`, {
        headers: { authorization: `Bearer ${freshToken}` },
        data: { visitId: activeVisitId, action: "start" },
      }), `Start concurrent Visit ${activeVisitId}`);
    }
    const concurrent = await service.from("visits")
      .select("id,status,started_at,finished_at")
      .in("id", reversed.slice(0, 2));
    expect(concurrent.error, concurrent.error?.message).toBeNull();
    expect(concurrent.data?.length).toBe(2);
    for (const row of concurrent.data || []) {
      expect(row.status).toBe("in_progress");
      expect(row.started_at).toBeTruthy();
      expect(row.finished_at).toBeNull();
    }
    const liveRoute = await bodyOf(await request.get(`${appUrl}/api/mobile/employee/route?date=${date}`, {
      headers: { authorization: `Bearer ${freshToken}` },
    }), "Employee route with concurrent active Visits");
    const liveById = new Map((liveRoute.stops || []).map((stop: any) => [String(stop.visitId), stop]));
    for (const activeVisitId of reversed.slice(0, 2)) {
      expect(liveById.get(activeVisitId)?.status).toBe("in_progress");
      expect(liveById.get(activeVisitId)?.startedAt).toBeTruthy();
    }

    // Reset must also be safe when the Visit is already Open/scheduled.
    const openVisitId = reversed[2];
    const openReset = await bodyOf(await request.patch(`${appUrl}/api/mobile/employee/route`, {
      headers: { authorization: `Bearer ${freshToken}` },
      data: { visitId: openVisitId, action: "reset", reason: "QA idempotent Open reset." },
    }), "Reset already Open Visit");
    expect(openReset.idempotent).toBe(true);
    expect(openReset.visit?.status).toBe("scheduled");
    expect(openReset.visit?.started_at).toBeNull();

    // Return active fixtures to Open after proving independent timers.
    for (const activeVisitId of reversed.slice(0, 2)) {
      const resetActive = await bodyOf(await request.patch(`${appUrl}/api/mobile/employee/route`, {
        headers: { authorization: `Bearer ${freshToken}` },
        data: { visitId: activeVisitId, action: "reset", reason: "QA concurrent timer cleanup." },
      }), `Reset concurrent Visit ${activeVisitId}`);
      expect(resetActive.visit?.status).toBe("scheduled");
    }
    console.log(JSON.stringify({ checkpoint: "employee-multi-active-timers", activeCount: 2, resetOpen: true }));

    const audit = await service.from("route_order_audit").select("route_id,source,next_order,route_version")'''
if anchor in test:
    test = test.replace(anchor, addition, 1)
elif 'employee-multi-active-timers' not in test:
    raise SystemExit('Smart Route regression test anchor not found')
test_path.write_text(test)
