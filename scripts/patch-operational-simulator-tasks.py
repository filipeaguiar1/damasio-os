from pathlib import Path

route_path = Path("app/api/admin/operational-simulator/route.ts")
text = route_path.read_text()
changed = False

replacements = [
    (
        '    await service.from("tasks").delete().in("source_visit_id", visitIds);\n',
        '',
    ),
    (
        '    await service.from("tasks").delete().in("customer_id", customerIds);\n',
        '',
    ),
    (
        '''      const taskRows = customerRows.chains.filter((_, index) => index % 20 === 0).map((chain, index) => ({
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        source_visit_id: operations.lastVisits.get(chain.customerId),
        assigned_employee_id: workers[chain.workerIndex].employeeId,
        assigned_crew_id: workers[chain.workerIndex].crewId,
        title: "Simulation quality follow-up",
        customer_issue: "Gate edge required a quick second pass.",
        priority: "normal",
        status: "resolved",
        scheduled_date: operations.simulationEnd,
        assigned_at: `${operations.simulationEnd}T18:00:00.000Z`,
        resolved_at: `${operations.simulationEnd}T19:00:00.000Z`,
        completion_summary: `Resolved by ${workers[chain.workerIndex].name}. ${SIM_MARKER} #${index + 1}`,
      }));
      await insertRowsWithFallback(service, "tasks", taskRows, ["company_id"]);
''',
        '''      // A real Return Visit Task is created later by the temporary Customer through create_customer_task.
      const taskRows: Record<string, unknown>[] = [];
''',
    ),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
        changed = True

if changed:
    route_path.write_text(text)

print("changed" if changed else "already-fixed")
