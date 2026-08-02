from pathlib import Path

path = Path("tests/canonical-route-sync.spec.ts")
text = path.read_text()
old = '''  const routeDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());'''
new = '''  const routeDate = String(simulation.operational?.liveDate || "");
  expect(routeDate).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/);'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one browser-derived routeDate block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("Canonical liveDate E2E alignment applied.")
