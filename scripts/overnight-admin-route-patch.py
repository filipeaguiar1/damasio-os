from pathlib import Path

path = Path("app/mobile/admin/routes/page.tsx")
source = path.read_text(encoding="utf-8")
old = '{!homes.length && <div className="mobile-native-empty"><i>⌖</i><strong>{canonicalLoading ? "Loading official route" : "No houses found"}</strong><p>{canonicalLoading ? "Reading the latest canonical route version…" : "Only canonical Jobs and dated Visits appear here."}</p></div>}'
new = '{!homes.length && <div className="mobile-native-empty"><i>⌖</i><strong>No houses found</strong><p>Only canonical Jobs and dated Visits appear here.</p></div>}'
if old not in source:
    raise SystemExit("Expected admin route empty-state block was not found")
path.write_text(source.replace(old, new), encoding="utf-8")
