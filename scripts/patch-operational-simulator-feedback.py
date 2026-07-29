from pathlib import Path

route_path = Path("app/api/admin/operational-simulator/route.ts")
text = route_path.read_text()
changed = False

replacements = [
    (
        '    await service.from("feedback").delete().in("visit_id", visitIds);\n',
        '',
    ),
    (
        '    await service.from("feedback").delete().in("customer_id", customerIds);\n',
        '',
    ),
    (
        '''      const feedbackRows = customerRows.chains.map((chain, index) => ({
        id: randomUUID(),
        organization_id: companyId,
        company_id: companyId,
        customer_id: chain.customerId,
        property_id: chain.propertyId,
        visit_id: operations.lastVisits.get(chain.customerId),
        rating: index % 10 === 0 ? 4 : 5,
        comment: index % 10 === 0 ? "Good service; gate area needed a second pass." : "Service completed well and photo received.",
      }));
      await insertRowsWithFallback(service, "feedback", feedbackRows, ["company_id"]);
''',
        '''      // Feedback is intentionally submitted by the temporary Customer through the canonical portal RPC.
      const feedbackRows: Record<string, unknown>[] = [];
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
