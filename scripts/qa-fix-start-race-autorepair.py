from pathlib import Path

path = Path('app/api/mobile/employee/route/route.ts')
text = path.read_text()

old_select = '.select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds")'
new_select = '.select("id,status,scheduled_date,assigned_employee_id,crew_id,started_at,finished_at,duration_seconds,route_id,route_order")'
if old_select in text:
    text = text.replace(old_select, new_select, 1)
elif new_select not in text:
    raise SystemExit('fallback select anchor not found')

old = '''  if (action === "start") {\n    if (previousStatus !== "scheduled") throw new Error("Only an Open Visit can be started.");\n    nextStatus = "in_progress";\n    patch = { status: nextStatus, started_at: nowIso, finished_at: null, duration_seconds: null };\n  } else if (action === "done") {'''
new = '''  if (action === "start") {\n    // Repeated Start is a successful no-op once the canonical Visit is already\n    // active. This closes the race where two near-simultaneous requests both read\n    // scheduled, one commits first, and the second arrives here after the commit.\n    if (previousStatus === "in_progress") {\n      if (visit.started_at && !visit.finished_at) return visit;\n      // Repair a partially-started Visit instead of trapping the field worker in\n      // an error loop. Preserve a valid started_at; otherwise establish it once.\n      nextStatus = "in_progress";\n      patch = {\n        started_at: visit.started_at || nowIso,\n        finished_at: null,\n        duration_seconds: null,\n      };\n      auditAction = "visit.execution.auto_repair";\n    } else {\n      if (previousStatus !== "scheduled") throw new Error("Only an Open Visit can be started.");\n      nextStatus = "in_progress";\n      patch = { status: nextStatus, started_at: nowIso, finished_at: null, duration_seconds: null };\n    }\n  } else if (action === "done") {'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('fallback start anchor not found')

# Improve server diagnostics without exposing internal state to the mobile UI.
old_warn = '''    } else {\n      console.warn("employee-route-rpc-fallback", { visitId, action, message: result.error.message });\n    }'''
new_warn = '''    } else {\n      const currentAfterRpc = action === "start"\n        ? await service.from("visits").select("id,status,started_at,finished_at,duration_seconds").eq("id", visitId).or(companyFilter(companyId)).maybeSingle()\n        : null;\n      console.warn("employee-route-rpc-fallback", {\n        visitId,\n        action,\n        message: result.error.message,\n        storedStatus: currentAfterRpc?.data?.status || null,\n        hasStartedAt: Boolean(currentAfterRpc?.data?.started_at),\n        hasFinishedAt: Boolean(currentAfterRpc?.data?.finished_at),\n      });\n    }'''
if old_warn in text:
    text = text.replace(old_warn, new_warn, 1)
elif new_warn not in text:
    raise SystemExit('rpc fallback log anchor not found')

path.write_text(text)
