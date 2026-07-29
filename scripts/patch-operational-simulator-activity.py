from pathlib import Path

route_path = Path("app/api/admin/operational-simulator/route.ts")
text = route_path.read_text()
changed = False

replacements = [
    (
        'const SIM_ACTION = "operational_simulation.created";\n',
        '',
    ),
    (
        '  await service.from("activity_log").delete().eq("company_id", companyId).ilike("details", `%${SIM_MARKER}%`);\n',
        '',
    ),
    (
        '    const { service, companyId, actorId, actorName } = await requireAdmin(request);',
        '    const { service, companyId } = await requireAdmin(request);',
    ),
    (
        '      await insertRowsWithFallback(service, "activity_log", operations.notes, ["company_id"]);\n',
        '',
    ),
    (
        '''      const audit = await service.from("activity_log").insert({
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        actor_profile_id: actorId,
        action: SIM_ACTION,
        entity_type: "operational_simulation",
        entity_id: randomUUID(),
        details: `${SIM_MARKER} ${actorName || "Márcio"} created ${input.customerCount} customers, ${workers.length} workers, ${input.weeks} completed weeks, paid invoices, employee photos, feedback, resolved tasks and today's live routes.`,
      });
      if (audit.error) throw new Error(audit.error.message);

''',
        '''      // The canonical audit trail remains attached to the company records themselves:
      // Customer notes, Visit execution notes, private Photos, Payments, Feedback and resolved Tasks.

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
