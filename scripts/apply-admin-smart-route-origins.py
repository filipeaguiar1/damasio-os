from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


def replace_regex_once(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected exactly one regex match in {path}, found {count}: {pattern[:140]!r}")
    file.write_text(updated)


panel = "components/admin/RouteAdvisorPanel.tsx"

replace_once(
    panel,
    'import {\n  InteractiveRoutePreviewMap,\n  type RoutePreviewMetrics,\n} from "@/components/admin/InteractiveRoutePreviewMap";',
    'import {\n  InteractiveRoutePreviewMap,\n  type RoutePreviewMetrics,\n} from "@/components/admin/InteractiveRoutePreviewMap";\nimport { AddressAutocomplete } from "@/components/home/AddressAutocomplete";',
)

replace_once(
    panel,
    'type Origin = AdvisorPoint & { label: string };\ntype RemovedStop = { home: RouteLead; index: number };',
    'type Origin = AdvisorPoint & { label: string };\ntype SmartOriginMode = "current" | "last" | "manual" | "profile";\ntype RemovedStop = { home: RouteLead; index: number };',
)

replace_once(
    panel,
    '  const [busy, setBusy] = useState(false);\n  const [smartRouteAddress, setSmartRouteAddress] = useState("");\n  const [manualOrderOpen, setManualOrderOpen] = useState(true);',
    '  const [busy, setBusy] = useState(false);\n  const [smartOriginMode, setSmartOriginMode] = useState<SmartOriginMode>("current");\n  const [smartRouteAddress, setSmartRouteAddress] = useState("");\n  const [manualOriginPoint, setManualOriginPoint] = useState<Origin | null>(null);\n  const [manualOrderOpen, setManualOrderOpen] = useState(true);',
)

replace_regex_once(
    panel,
    r'''  useEffect\(\(\) => \{\n    if \(!employee\) \{\n      setSmartRouteAddress\(""\);\n      return;\n    \}\n    const canonicalAddress = liveRouteSnapshot\?\.origin\?\.address\?\.trim\(\)\n      \|\| \(liveRouteSnapshot\?\.origin\?\.label\n        && !/\^\(route start\|first canonical stop\)\$/i\.test\(liveRouteSnapshot\.origin\.label\.trim\(\)\)\n        \? liveRouteSnapshot\.origin\.label\.trim\(\)\n        : ""\);\n    setSmartRouteAddress\(canonicalAddress \|\| employee\.routeStartAddress \|\| ""\);\n  \}, \[employee\?\.id, currentRouteId, liveRouteSnapshot\?\.routeVersion\]\);\n''',
    '''  const lastCompleted = useMemo(() => currentRoute
    .filter(item => routeStatus(item) === "completed")
    .slice()
    .sort((left, right) =>
      (left.visitFinishedAt || "").localeCompare(right.visitFinishedAt || "")
      || (left.routeOrder ?? 0) - (right.routeOrder ?? 0))
    .at(-1) || null,
  [currentRoute]);
  const profileStartAddress = employee?.routeStartAddress?.trim() || "";
  const smartOriginReady = smartOriginMode === "current"
    || (smartOriginMode === "last" && Boolean(lastCompleted))
    || (smartOriginMode === "profile" && Boolean(profileStartAddress))
    || (smartOriginMode === "manual" && smartRouteAddress.trim().length >= 3);
  const smartOriginSummary = smartOriginMode === "current"
    ? "Use this browser's current location"
    : smartOriginMode === "last"
      ? lastCompleted?.address || "No completed house is available"
      : smartOriginMode === "profile"
        ? profileStartAddress || "No route start address is saved in this Employee profile"
        : smartRouteAddress.trim() || "Type a starting address";
''',
)

replace_once(
    panel,
    '''  function changeEmployee(next: string) {
    const nextEmployee = employees.find(item => item.id === next) || null;
    setEmployeeId(next);
    setSmartRouteAddress(nextEmployee?.routeStartAddress || "");
    setManualOrderOpen(true);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }''',
    '''  function changeEmployee(next: string) {
    setEmployeeId(next);
    setSmartOriginMode("current");
    setSmartRouteAddress("");
    setManualOriginPoint(null);
    setManualOrderOpen(true);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }''',
)

replace_regex_once(
    panel,
    r'''  async function generatePreview\(addressOverride\?: string\) \{.*?\n  const locked = useMemo\(\(\) => new Set\(lockedJobIds\), \[lockedJobIds\]\);''',
    '''  function selectSmartOrigin(mode: SmartOriginMode) {
    setSmartOriginMode(mode);
    setOrigin(null);
    if (mode !== "manual") setManualOriginPoint(null);
    if (mode === "last" && !lastCompleted) {
      setMessage("No completed house is available for this Employee and date.");
    } else if (mode === "profile" && !profileStartAddress) {
      setMessage("Save a route start address in the Employee profile before using this option.");
    } else {
      setMessage("");
    }
  }

  async function resolveSmartOrigin(): Promise<Origin> {
    if (smartOriginMode === "current") {
      if (!navigator.geolocation) throw new Error("Current location is not available in this browser.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
          maximumAge: 30_000,
        }));
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: "Current location",
      };
    }

    if (smartOriginMode === "last") {
      if (!lastCompleted) throw new Error("No completed house is available for this Employee and date.");
      if (Number.isFinite(lastCompleted.latitude) && Number.isFinite(lastCompleted.longitude)) {
        return {
          latitude: Number(lastCompleted.latitude),
          longitude: Number(lastCompleted.longitude),
          label: lastCompleted.address,
        };
      }
      const point = await geocode(lastCompleted.address);
      return { ...point, label: lastCompleted.address };
    }

    if (smartOriginMode === "profile") {
      if (!profileStartAddress) throw new Error("This Employee profile has no saved route start address.");
      const point = await geocode(profileStartAddress);
      return { ...point, label: profileStartAddress };
    }

    const manualAddress = smartRouteAddress.trim();
    if (!manualAddress) throw new Error("Enter a valid manual starting address.");
    if (manualOriginPoint && manualOriginPoint.label === manualAddress) return manualOriginPoint;
    const point = await geocode(manualAddress);
    return { ...point, label: manualAddress };
  }

  async function generatePreview() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!smartOriginReady) {
      setMessage("Choose an available Smart Route starting point.");
      return;
    }
    if (currentRoute.some(item => routeStatus(item) === "in_progress")) {
      setMessage("An in-progress Visit blocks route preview and publication for this Employee/date.");
      return;
    }

    const selectedConflict = selectedHomes
      .map(home => ({ home, occurrence: occurrencesOnDate.get(canonicalJobId(home)) }))
      .find(item => ["completed", "in_progress", "missed"].includes(routeStatus(item.occurrence)));
    if (selectedConflict?.occurrence) {
      const status = routeStatus(selectedConflict.occurrence);
      setMessage(status === "completed"
        ? "Esta casa já foi concluída hoje"
        : status === "missed"
          ? "Needs Reschedule: choose a new date."
          : "This house is currently in progress.");
      return;
    }

    setBusy(true);
    setMessage("Optimizing the initial suggestion and preparing manual route controls...");
    try {
      const locked = currentRoute.filter(item => routeStatus(item) === "completed");
      const mutableCurrent = currentRoute.filter(item => routeStatus(item) === "scheduled");
      const selectedCanonical = selectedHomes.map(home => {
        const id = canonicalJobId(home);
        const targetOccurrence = occurrencesOnDate.get(id);
        if (targetOccurrence && routeStatus(targetOccurrence) === "scheduled") return targetOccurrence;
        const missed = latestMissedByJob.get(id);
        if (missed && missed.scheduledDate !== date) return missed;
        return home;
      });
      const combinedByJob = new Map<string, RouteLead>();
      for (const home of [...locked, ...mutableCurrent, ...selectedCanonical]) {
        combinedByJob.set(canonicalJobId(home), home);
      }
      const combined = [...combinedByJob.values()];

      if (!combined.length) {
        setMessage("Select houses or keep at least one existing scheduled stop.");
        return;
      }
      if (combined.length > employee.dailyCapacity) {
        setMessage(`${employee.name}'s profile allows ${employee.dailyCapacity} houses per day. Remove ${combined.length - employee.dailyCapacity}.`);
        return;
      }

      const start = await resolveSmartOrigin();
      const mapped = await Promise.all(combined.map(locate));
      const mutable = mapped.filter(home => !locked.some(item => canonicalJobId(item) === canonicalJobId(home)));
      let optimizedMutable = [...mutable];

      if (mutable.length > 1) {
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: [start.longitude, start.latitude],
            coordinates: mutable.map(home => [
              Number(home.longitude),
              Number(home.latitude),
            ]),
          }),
        });
        if (response.ok) {
          const result = await response.json() as { order: number[] };
          optimizedMutable = result.order.map(index => mutable[index]).filter(Boolean);
        }
      }

      const lockedByPosition = new Map<number, RouteLead>();
      for (const home of locked) {
        const mappedLocked = mapped.find(item => canonicalJobId(item) === canonicalJobId(home));
        if (mappedLocked && home.routeOrder) lockedByPosition.set(home.routeOrder - 1, mappedLocked);
      }

      const final: RouteLead[] = [];
      let mutableIndex = 0;
      for (let index = 0; index < mapped.length; index++) {
        const lockedHome = lockedByPosition.get(index);
        final.push(lockedHome || optimizedMutable[mutableIndex++]);
      }
      while (mutableIndex < optimizedMutable.length) final.push(optimizedMutable[mutableIndex++]);

      setOrigin(start);
      setLockedJobIds(locked.map(canonicalJobId));
      setPreview(normalizeOrder(final.filter(Boolean)));
      setRemoved([]);
      setManualOrderOpen(true);
      setMessage("Smart Route ready from the selected starting point. Manual changes remain available below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route preview could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function applySmartRoute() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!smartOriginReady) {
      setMessage("Choose an available Smart Route starting point.");
      return;
    }
    if (!preview.length) {
      await generatePreview();
      return;
    }
    if (preview.some(item => routeStatus(item) === "in_progress")) {
      setMessage("An in-progress Visit blocks Smart Route recalculation.");
      return;
    }

    setBusy(true);
    setMessage("Calculating the most efficient order from the selected starting point...");
    try {
      const start = await resolveSmartOrigin();
      const mapped = await Promise.all(preview.map(locate));
      const mutable = mapped.filter(home => !locked.has(canonicalJobId(home)));
      let optimizedMutable = [...mutable];

      if (mutable.length > 1) {
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: [start.longitude, start.latitude],
            coordinates: mutable.map(home => [
              Number(home.longitude),
              Number(home.latitude),
            ]),
          }),
        });
        if (!response.ok) throw new Error("Smart Route optimization could not be calculated.");
        const result = await response.json() as { order: number[] };
        optimizedMutable = result.order.map(index => mutable[index]).filter(Boolean);
      }

      setOrigin(start);
      setPreview(reconstructMutable(optimizedMutable));
      setRemoved([]);
      setManualOrderOpen(true);
      setMessage("Smart Route recalculated. Review the order below, make manual changes if needed, then publish.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Smart Route could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  const locked = useMemo(() => new Set(lockedJobIds), [lockedJobIds]);''',
)

replace_once(
    panel,
    '            label: smartRouteAddress.trim() || origin.label,',
    '            label: origin.label,',
)

replace_regex_once(
    panel,
    r'''  const smartRoutePanel = <section className="advisor-smart-route">.*?</section>;\n\n  return <section className="advisor-shell">''',
    '''  const smartRoutePanel = <section className="advisor-smart-route">
    <div className="advisor-smart-header">
      <span>SMART ROUTE</span>
      <h3>Choose where the route starts.</h3>
      <p>Use the same four starting options available on mobile. The selected point and optimized order are saved together in the canonical Route.</p>
    </div>

    <div className="advisor-origin-modes" role="group" aria-label="Smart Route starting point">
      <button
        type="button"
        className={smartOriginMode === "current" ? "active" : ""}
        aria-pressed={smartOriginMode === "current"}
        onClick={() => selectSmartOrigin("current")}
      >
        <b>Current location</b>
        <small>Browser GPS</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "last" ? "active" : ""}
        aria-pressed={smartOriginMode === "last"}
        disabled={!lastCompleted}
        onClick={() => selectSmartOrigin("last")}
      >
        <b>Last completed house</b>
        <small>{lastCompleted ? "Latest finished Visit" : "Unavailable"}</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "manual" ? "active" : ""}
        aria-pressed={smartOriginMode === "manual"}
        onClick={() => selectSmartOrigin("manual")}
      >
        <b>Manual address</b>
        <small>Search or type</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "profile" ? "active" : ""}
        aria-pressed={smartOriginMode === "profile"}
        disabled={!profileStartAddress}
        onClick={() => selectSmartOrigin("profile")}
      >
        <b>Profile address</b>
        <small>{profileStartAddress ? "Saved previously" : "Not configured"}</small>
      </button>
    </div>

    <div className="advisor-origin-row">
      <div className="advisor-origin-detail">
        {smartOriginMode === "manual" ? <label>
          <span>Manual start address</span>
          <AddressAutocomplete
            value={smartRouteAddress}
            onChange={value => {
              setSmartRouteAddress(value);
              setManualOriginPoint(null);
              setOrigin(null);
            }}
            onSelect={suggestion => {
              setSmartRouteAddress(suggestion.label);
              setManualOriginPoint({
                label: suggestion.label,
                latitude: suggestion.latitude,
                longitude: suggestion.longitude,
              });
              setOrigin(null);
            }}
            placeholder="Start typing the address..."
            ariaLabel="Smart Route manual start address"
          />
        </label> : <div className="advisor-origin-summary">
          <span>Selected start</span>
          <strong>{smartOriginSummary}</strong>
        </div>}
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !employee || !smartOriginReady}
        onClick={() => void applySmartRoute()}
      >
        {busy ? "Calculating..." : preview.length ? "Recalculate Smart Route" : "Generate Smart Route"}
      </button>
    </div>
  </section>;

  return <section className="advisor-shell">''',
)

replace_once(
    panel,
    '.advisor-hero span,.advisor-manual-order header span,.advisor-smart-route>div>span,.advisor-reopen>div>span{',
    '.advisor-hero span,.advisor-manual-order header span,.advisor-smart-header>span,.advisor-reopen>div>span{',
)

replace_regex_once(
    panel,
    r'''      \.advisor-smart-route\{display:grid!important;grid-template-columns:minmax\(0,1\.15fr\) minmax\(280px,1fr\) auto;gap:16px;align-items:end;padding:18px\}\.advisor-smart-route h3\{margin:5px 0 4px;color:#173a2c\}\.advisor-smart-route p\{margin:0;color:#64748b;font-size:12px;line-height:1\.45\}\.advisor-smart-route label\{display:grid;gap:6px\}\.advisor-smart-route label>span\{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase\}\.advisor-smart-route input\{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c\}\.advisor-smart-route \.btn\{min-height:48px;white-space:nowrap\}''',
    '''      .advisor-smart-route{display:grid!important;gap:14px;padding:18px}.advisor-smart-header h3{margin:5px 0 4px;color:#173a2c}.advisor-smart-header p{margin:0;color:#64748b;font-size:12px;line-height:1.45}.advisor-origin-modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.advisor-origin-modes>button{display:grid;gap:3px;min-height:62px;border:1px solid #d5e1db;border-radius:13px;background:#fbfdfc;padding:10px 11px;color:#173a2c;text-align:left;cursor:pointer}.advisor-origin-modes>button:hover:not(:disabled){border-color:#69a88d;background:#f4faf7}.advisor-origin-modes>button.active{border-color:#0b7655;background:#eaf7f0;box-shadow:inset 0 0 0 1px #0b7655}.advisor-origin-modes>button:disabled{cursor:not-allowed;opacity:.5}.advisor-origin-modes b,.advisor-origin-modes small{display:block}.advisor-origin-modes b{font-size:11px}.advisor-origin-modes small{color:#64748b;font-size:9px}.advisor-origin-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.advisor-origin-detail label{display:grid;gap:6px}.advisor-origin-detail label>span,.advisor-origin-summary>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.advisor-origin-summary{display:grid;gap:6px;min-height:48px;padding:10px 13px;border:1px solid #dbe7e1;border-radius:12px;background:#f8fbf9}.advisor-origin-summary strong{color:#173a2c;font-size:12px;line-height:1.3}.advisor-origin-detail .address-autocomplete{position:relative}.advisor-origin-detail .address-suggestions{z-index:45}.advisor-smart-route input{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c}.advisor-smart-route .btn{min-height:48px;white-space:nowrap}''',
)

replace_once(
    panel,
    '''      @media(max-width:1150px){.advisor-reopen{grid-template-columns:1fr 1fr}.advisor-controls{grid-template-columns:1fr 1fr}.advisor-smart-route{grid-template-columns:1fr 1fr!important}.advisor-smart-route>div{grid-column:1/-1}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}
      @media(max-width:760px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar,.advisor-manual-order>header{align-items:stretch;flex-direction:column}.advisor-controls,.advisor-reopen,.advisor-impact,.advisor-smart-route{grid-template-columns:1fr!important}.advisor-smart-route>div{grid-column:auto}.advisor-smart-route .btn{width:100%}.advisor-manual-summary{align-items:stretch;flex-direction:column}.advisor-manual-order header small{text-align:left}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}.advisor-manual-order article{grid-template-columns:34px 1fr}.advisor-manual-order article>div{grid-column:1/-1;flex-wrap:wrap}.advisor-removed>div{grid-template-columns:1fr}}''',
    '''      @media(max-width:1150px){.advisor-reopen{grid-template-columns:1fr 1fr}.advisor-controls{grid-template-columns:1fr 1fr}.advisor-origin-modes{grid-template-columns:repeat(2,minmax(0,1fr))}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}
      @media(max-width:760px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar,.advisor-manual-order>header{align-items:stretch;flex-direction:column}.advisor-controls,.advisor-reopen,.advisor-impact{grid-template-columns:1fr!important}.advisor-origin-row{grid-template-columns:1fr}.advisor-origin-modes{grid-template-columns:repeat(2,minmax(0,1fr))}.advisor-smart-route .btn{width:100%}.advisor-manual-summary{align-items:stretch;flex-direction:column}.advisor-manual-order header small{text-align:left}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}.advisor-manual-order article{grid-template-columns:34px 1fr}.advisor-manual-order article>div{grid-column:1/-1;flex-wrap:wrap}.advisor-removed>div{grid-template-columns:1fr}}''',
)

validation = Path("scripts/validate-admin-smart-route-origins.mjs")
validation.write_text('''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("components/admin/RouteAdvisorPanel.tsx", "utf8");

for (const label of [
  "Current location",
  "Last completed house",
  "Manual address",
  "Profile address",
]) {
  assert.match(panel, new RegExp(label), `Missing Smart Route origin option: ${label}`);
}

assert.match(panel, /AddressAutocomplete/, "Manual address must use the shared autocomplete component.");
assert.match(panel, /navigator\\.geolocation\\.getCurrentPosition/, "Current location must use browser geolocation.");
assert.match(panel, /lastCompleted/, "Last completed house must come from the canonical route.");
assert.match(panel, /profileStartAddress/, "Profile address must come from the selected Employee profile.");
assert.match(panel, /manualOriginPoint/, "Autocomplete coordinates must be reused after selection.");
assert.match(panel, /label: origin\\.label/, "The selected origin label must be published with the canonical Route.");
assert.doesNotMatch(
  panel,
  /setSmartRouteAddress\\(canonicalAddress \\|\\| employee\\.routeStartAddress/,
  "The manual field cannot be silently populated from another origin mode.",
);

console.log("PASS Admin Smart Route exposes four explicit canonical origin options with autocomplete");
''')
