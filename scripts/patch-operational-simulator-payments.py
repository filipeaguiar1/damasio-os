from pathlib import Path

route_path = Path("app/api/admin/operational-simulator/route.ts")
text = route_path.read_text()
changed = False

replacements = [
    (
        '''  const invoices = customerIds.length ? await service.from("invoices").select("id").in("customer_id", customerIds) : { data: [], error: null };
  if (invoices.error) throw new Error(invoices.error.message);
  const invoiceIds = (invoices.data || []).map((row: any) => String(row.id));
''',
        '',
    ),
    (
        '  if (invoiceIds.length) await service.from("payments").delete().in("invoice_id", invoiceIds);\n',
        '',
    ),
    (
        '    await service.from("payments").delete().in("customer_id", customerIds);\n',
        '',
    ),
    (
        '      await insertRowsWithFallback(service, "payments", billing.payments, ["company_id"]);\n',
        '      // Paid invoice status is the canonical simulated settlement. No Stripe or protected payments-table write occurs.\n',
    ),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
        changed = True

if changed:
    route_path.write_text(text)

print("changed" if changed else "already-fixed")
