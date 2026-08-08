from pathlib import Path
import re
import runpy


route_path = Path("app/api/admin/operational-simulator/route.ts")
marker = 'const activeCustomers = await service.from("customers")'

if marker in route_path.read_text():
    print("Validated operational blocker fixes are already persisted; no runner patch needed.")
    raise SystemExit(0)

runpy.run_path("scripts/qa-final-two-blockers.py", run_name="__main__")

text = route_path.read_text()

type_replacements = {
    '  const customerIds = (customers.data || []).map((row: any) => String(row.id));': '  const customerIds: string[] = (customers.data || []).map((row: any) => String(row.id));',
    '  const profileIds = [...new Set([': '  const profileIds: string[] = [...new Set<string>([',
    '  const routeIds = [...new Set(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];': '  const routeIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];',
    '  const crewIds = [...new Set(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];': '  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];',
    '    for (const batch of chunks(customerIds, 4)) {': '    for (const batch of chunks<string>(customerIds, 4)) {',
}
for old, new in type_replacements.items():
    if old not in text:
        raise SystemExit(f"Cleanup type anchor not found: {old}")
    text = text.replace(old, new, 1)

customer_pattern = re.compile(
    r'  const customers = await service\.from\("customers"\)\.select\("id,profile_id"\)\s*\n\s*\.or\(companyFilter\(companyId\)\)\.like\("email", pattern\);'
)
customer_replacement = '''  const activeCustomers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern).is("archived_at", null).limit(120);
  if (activeCustomers.error) throw new Error(activeCustomers.error.message);
  const archivedCustomers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern).not("archived_at", "is", null).limit(4);
  if (archivedCustomers.error) throw new Error(archivedCustomers.error.message);
  const customers = {
    data: [...(activeCustomers.data || []), ...(archivedCustomers.data || [])],
    error: null as { message: string } | null,
  };'''
text, count = customer_pattern.subn(customer_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"Customer cleanup query patch matched {count} blocks")

worker_pattern = re.compile(
    r'  const workerProfiles = await service\.from\("profiles"\)\.select\("id"\)\s*\n\s*\.eq\("role", "employee"\)\.or\(companyFilter\(companyId\)\)\.like\("email", pattern\);'
)
worker_replacement = '''  const workerProfiles = await service.from("profiles").select("id")
    .eq("role", "employee").eq("active", true).or(companyFilter(companyId)).like("email", pattern);'''
text, count = worker_pattern.subn(worker_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"Active simulator worker patch matched {count} blocks")

delete_pattern = re.compile(
    r'(\s+const batchRemoved = await remove\(label, service\.from\(table\)\.delete\(\)\.in\(field, batch\), optional\);\n)(\s+)(removed = batchRemoved && removed;)'
)
text, count = delete_pattern.subn(r'\1\2if (!batchRemoved && optional) return false;\n\2\3', text, count=1)
if count != 1:
    raise SystemExit(f"Optional delete short-circuit patch matched {count} blocks")

update_pattern = re.compile(
    r'(\s+const batchUpdated = await remove\(label, service\.from\(table\)\.update\(values\)\.in\(field, batch\), optional\);\n)(\s+)(updated = batchUpdated && updated;)'
)
text, count = update_pattern.subn(r'\1\2if (!batchUpdated && optional) return false;\n\2\3', text, count=1)
if count != 1:
    raise SystemExit(f"Optional update short-circuit patch matched {count} blocks")

replacements = {
    '    await removeByIds("route_stops", "route_stops", "route_id", routeIds);': '''    for (const batch of chunks(routeIds, 25)) {
      await remove("route_stops", service.from("route_stops").delete().in("route_id", batch));
    }''',
    '    await removeByIds("route_order_state", "route_order_state", "route_id", routeIds);': '''    for (const batch of chunks(routeIds, 25)) {
      await remove("route_order_state", service.from("route_order_state").delete().in("route_id", batch));
    }''',
    '    if (routeIds.length) await removeByIds("routes", "routes", "id", routeIds);': '    if (routeIds.length) await removeByIds("routes", "routes", "id", routeIds, true);',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"Explicit canonical cleanup anchor not found: {old}")
    text = text.replace(old, new, 1)

core_cleanup_pattern = re.compile(
    r'  if \(visitsDeleted\) \{.*?\n  \}\n\n  const storageDelete',
    re.S,
)
core_cleanup_replacement = '''  if (!visitsDeleted) {
    console.warn("operational-simulator cleanup archived core rows because Visit deletion was unavailable.");
  }
  const archivedAt = new Date().toISOString();
  if (customerIds.length) await updateByIds("archive customers", "customers", { archived_at: archivedAt }, "id", customerIds);
  if (jobIds.length) await updateByIds("deactivate jobs", "jobs", { active: false }, "id", jobIds);
  if (employeeIds.length) await updateByIds("deactivate employees", "employees", { active: false }, "id", employeeIds);
  if (crewIds.length) await updateByIds("deactivate crews", "crews", { active: false }, "id", crewIds);
  if (profileIds.length) await updateByIds("deactivate profiles", "profiles", { active: false }, "id", profileIds);

  const storageDelete'''
text, count = core_cleanup_pattern.subn(core_cleanup_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"Protected core archive patch matched {count} blocks")

route_path.write_text(text)
print("Validated operational blocker fixes applied for persistence.")
