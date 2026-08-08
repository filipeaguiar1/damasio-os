from pathlib import Path

path = Path('app/api/mobile/employee/route/route.ts')
text = path.read_text()

anchor = '''    // Reset is intentionally idempotent for an Open Visit. This lets the field app\n    // clear a stale/local timer safely without creating a fake execution transition.\n    if (action === "reset") {\n'''
insert = '''    // Start is intentionally idempotent for a Visit that is already active. The\n    // first tap may have committed in the database before a mobile UI refresh lands;\n    // a repeated tap must return the same canonical started_at instead of raising an\n    // error or restarting the timer. This keeps every device on one universal clock.\n    if (action === "start") {\n      const currentStart = await service\n        .from("visits")\n        .select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds,route_id,route_order")\n        .eq("id", visitId)\n        .or(companyFilter(companyId))\n        .maybeSingle();\n      if (currentStart.error) throw new Error(currentStart.error.message);\n      const currentVisit = currentStart.data;\n      if (!currentVisit) throw new Error("Visit not found in this company.");\n      const assigned = currentVisit.assigned_employee_id === employee.id\n        || (!currentVisit.assigned_employee_id && Boolean(employee.crew_id) && currentVisit.crew_id === employee.crew_id);\n      if (!assigned) throw new Error("This Visit is not assigned to the authenticated Employee.");\n      if (currentVisit.scheduled_date !== torontoDateKey()) {\n        throw new Error("Employees can change execution only for today in America/Toronto.");\n      }\n      if (currentVisit.status === "in_progress" && executionTransitionConverged("start", currentVisit)) {\n        return NextResponse.json({ visit: currentVisit, fallback: false, verified: true, idempotent: true });\n      }\n    }\n\n    // Reset is intentionally idempotent for an Open Visit. This lets the field app\n    // clear a stale/local timer safely without creating a fake execution transition.\n    if (action === "reset") {\n'''

if insert in text:
    print('idempotent start patch already applied')
elif anchor in text:
    text = text.replace(anchor, insert, 1)
else:
    raise SystemExit('idempotent start anchor not found')

path.write_text(text)
