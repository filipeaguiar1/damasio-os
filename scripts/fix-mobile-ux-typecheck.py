from pathlib import Path
root = Path(__file__).resolve().parents[1]
path = root / "app/mobile/employee/page.tsx"
text = path.read_text()
old = 'await runVisitStatusOrQueue(selected.canonicalVisitId,"cancelled")'
new = 'await runVisitStatusOrQueue(selected.canonicalVisitId,"missed")'
if old not in text:
    raise SystemExit("Expected Employee skip call not found")
path.write_text(text.replace(old, new, 1))
print("Restored the typed skip action; database Smart Route compatibility remains in the migration.")
