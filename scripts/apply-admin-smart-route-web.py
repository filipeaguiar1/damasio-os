from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


panel = "components/admin/RouteAdvisorPanel.tsx"

replace_once(
    panel,
    '  const [loading, setLoading] = useState(true);\n  const [busy, setBusy] = useState(false);',
    '  const [loading, setLoading] = useState(true);\n  const [busy, setBusy] = useState(false);\n  const [smartRouteAddress, setSmartRouteAddress] = useState("");\n  const [manualOrderOpen, setManualOrderOpen] = useState(true);',
)

replace_once(
    panel,
    '''  useEffect(() => {
    if (liveRouteError) setMessage(liveRouteError);
  }, [liveRouteError]);

  const normalizedQuery = query.trim().toLowerCase();''',
    '''  useEffect(() => {
    if (liveRouteError) setMessage(liveRouteError);
  }, [liveRouteError]);

  useEffect(() => {
    if (!employee) {
      setSmartRouteAddress("");
      return;
    }
    const canonicalAddress = liveRouteSnapshot?.origin?.address?.trim()
      || (liveRouteSnapshot?.origin?.label
        && !/^(route start|first canonical stop)$/i.test(liveRouteSnapshot.origin.label.trim())
        ? liveRouteSnapshot.origin.label.trim()
        : "");
    setSmartRouteAddress(canonicalAddress || employee.routeStartAddress || "");
  }, [employee?.id, currentRouteId, liveRouteSnapshot?.routeVersion]);

  const normalizedQuery = query.trim().toLowerCase();''',
)

replace_once(
    panel,
    '''  function changeEmployee(next: string) {
    setEmployeeId(next);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }''',
    '''  function changeEmployee(next: string) {
    const nextEmployee = employees.find(item => item.id === next) || null;
    setEmployeeId(next);
    setSmartRouteAddress(nextEmployee?.routeStartAddress || "");
    setManualOrderOpen(true);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }''',
)

replace_once(
    panel,
    '''  function changeDate(next: string) {
    setDate(next);
    setRecommendations([]);
    resetPreview();
  }''',
    '''  function changeDate(next: string) {
    setDate(next);
    setManualOrderOpen(true);
    setRecommendations([]);
    resetPreview();
  }''',
)

replace_once(
    panel,
    '''  async function generatePreview() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!employee.routeStartAddress) {
      setMessage(`Save a default route start address in ${employee.name}'s profile first.`);
      return;
    }''',
    '''  async function generatePreview(addressOverride?: string) {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    const startAddress = String(addressOverride || smartRouteAddress || employee.routeStartAddress || "").trim();
    if (!startAddress) {
      setMessage("Enter the Smart Route start address below before generating the route.");
      return;
    }''',
)

replace_once(
    panel,
    '      const start = await geocode(employee.routeStartAddress);',
    '      const start = await geocode(startAddress);',
)

replace_once(
    panel,
    '''      setOrigin({ ...start, label: `${employee.name} start` });
      setLockedJobIds(locked.map(canonicalJobId));
      setPreview(normalizeOrder(final.filter(Boolean)));
      setRemoved([]);
      setMessage("Preview ready. Use Up, Down or Position; the map and road metrics recalculate immediately.");''',
    '''      setSmartRouteAddress(startAddress);
      setOrigin({ ...start, label: startAddress });
      setLockedJobIds(locked.map(canonicalJobId));
      setPreview(normalizeOrder(final.filter(Boolean)));
      setRemoved([]);
      setManualOrderOpen(true);
      setMessage("Smart Route ready from the selected start address. Manual changes remain available below.");''',
)

replace_once(
    panel,
    '''  const locked = useMemo(() => new Set(lockedJobIds), [lockedJobIds]);''',
    '''  async function applySmartRoute() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    const startAddress = smartRouteAddress.trim();
    if (!startAddress) {
      setMessage("Enter a valid Smart Route start address.");
      return;
    }
    if (!preview.length) {
      await generatePreview(startAddress);
      return;
    }
    if (preview.some(item => routeStatus(item) === "in_progress")) {
      setMessage("An in-progress Visit blocks Smart Route recalculation.");
      return;
    }

    setBusy(true);
    setMessage("Calculating the most efficient order from the selected start address...");
    try {
      const start = await geocode(startAddress);
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

      setOrigin({ ...start, label: startAddress });
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
    '''  async function publish() {
    if (!employee || !preview.length) return;

    setBusy(true);''',
    '''  async function publish() {
    if (!employee || !preview.length) return;
    if (!origin) {
      setMessage("Generate the Smart Route start point before publishing.");
      return;
    }

    setBusy(true);''',
)

replace_once(
    panel,
    '''          orderedJobIds: preview.map(canonicalJobId),
          sourceVisitIds,
        }),''',
    '''          orderedJobIds: preview.map(canonicalJobId),
          sourceVisitIds,
          origin: {
            label: smartRouteAddress.trim() || origin.label,
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        }),''',
)

replace_once(
    panel,
    '''  const handleMetrics = useCallback((next: RoutePreviewMetrics) => {
    setMetrics(next);
  }, []);

  return <section className="advisor-shell">''',
    '''  const handleMetrics = useCallback((next: RoutePreviewMetrics) => {
    setMetrics(next);
  }, []);

  const smartRoutePanel = <section className="advisor-smart-route">
    <div>
      <span>SMART ROUTE</span>
      <h3>Start from the right address.</h3>
      <p>Set the Employee's starting point and calculate the most efficient canonical order. The route can still be adjusted manually before publishing.</p>
    </div>
    <label>
      <span>Start address</span>
      <input
        value={smartRouteAddress}
        onChange={(event: { target: { value: string } }) => setSmartRouteAddress(event.target.value)}
        placeholder="Street, city, province and postal code"
        autoComplete="street-address"
      />
    </label>
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy || !employee || !smartRouteAddress.trim()}
      onClick={() => void applySmartRoute()}
    >
      {busy ? "Calculating..." : preview.length ? "Recalculate Smart Route" : "Generate Smart Route"}
    </button>
  </section>;

  return <section className="advisor-shell">''',
)

replace_once(
    panel,
    '''        {!preview.length ? <section className="advisor-empty-preview">
          <div>
            <span>MANUAL PREVIEW</span>
            <h3>{employee ? `${employee.name} · ${date}` : "Choose an Employee"}</h3>
            <p>{employee
              ? `Capacity used ${currentRoute.length}/${employee.dailyCapacity}. The Admin may ignore the recommendation.`
              : "Choose any valid Employee and date."}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !employee}
            onClick={() => void generatePreview()}
          >
            {busy ? "Calculating..." : currentRoute.length ? "Edit current canonical route" : "Create route preview"}
          </button>
        </section> : <>
          <section className="advisor-impact">''',
    '''        {!preview.length ? <>
          <section className="advisor-empty-preview">
            <div>
              <span>MANUAL PREVIEW</span>
              <h3>{employee ? `${employee.name} · ${date}` : "Choose an Employee"}</h3>
              <p>{employee
                ? `Capacity used ${currentRoute.length}/${employee.dailyCapacity}. Open the editor or define a start address below.`
                : "Choose any valid Employee and date."}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !employee}
              onClick={() => void generatePreview()}
            >
              {busy ? "Calculating..." : currentRoute.length ? "Edit current canonical route" : "Create route preview"}
            </button>
          </section>
          {smartRoutePanel}
        </> : <>
          <section className="advisor-impact">''',
)

replace_once(
    panel,
    '''          </section>

          <section className="advisor-manual-order">
            <header>
              <div>
                <span>MANUAL ROUTE ORDER</span>
                <h3>Map and canonical route_order stay synchronized.</h3>
              </div>
              <small>Completed positions are locked. Pending houses support Up, Down and direct Position.</small>
            </header>
            <div>
              {preview.map((home, index) => {''',
    '''          </section>

          {smartRoutePanel}

          <section className="advisor-manual-order">
            <header>
              <div>
                <span>MANUAL ROUTE ORDER</span>
                <h3>Map and canonical route_order stay synchronized.</h3>
              </div>
              <div className="advisor-manual-summary">
                <small>Completed positions are locked. Pending houses support Up, Down and direct Position.</small>
                <button
                  type="button"
                  aria-expanded={manualOrderOpen}
                  aria-controls="advisor-manual-route-list"
                  onClick={() => setManualOrderOpen(current => !current)}
                >
                  <i aria-hidden="true">{manualOrderOpen ? "▲" : "▼"}</i>
                  {manualOrderOpen ? "Collapse" : "Expand"}
                </button>
              </div>
            </header>
            {manualOrderOpen && <div id="advisor-manual-route-list">
              {preview.map((home, index) => {''',
)

replace_once(
    panel,
    '''              })}
            </div>
          </section>

          {removed.length > 0 && <section className="advisor-removed">''',
    '''              })}
            </div>}
          </section>

          {removed.length > 0 && <section className="advisor-removed">''',
)

replace_once(
    panel,
    '.advisor-hero span,.advisor-manual-order header span,.advisor-reopen>div>span{',
    '.advisor-hero span,.advisor-manual-order header span,.advisor-smart-route>div>span,.advisor-reopen>div>span{',
)

replace_once(
    panel,
    '''      .advisor-empty-preview{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:28px}.advisor-empty-preview span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.1em}.advisor-empty-preview h3{margin:6px 0;font-size:27px}.advisor-empty-preview p{margin:0;color:#64748b}.advisor-impact{display:grid!important;grid-template-columns:repeat(4,1fr);gap:1px;overflow:hidden;padding:0!important}.advisor-impact div{padding:14px 16px;background:#fff}.advisor-impact span,.advisor-impact strong{display:block}.advisor-impact span{color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.advisor-impact strong{margin-top:4px;color:#173a2c}
      .advisor-manual-order{overflow:hidden}.advisor-manual-order>header{display:flex;justify-content:space-between;gap:18px;align-items:end;padding:16px;border-bottom:1px solid #e7eeea}.advisor-manual-order header span{color:#0b7655}.advisor-manual-order h3{margin:4px 0 0}.advisor-manual-order header small{max-width:390px;color:#64748b;text-align:right}.advisor-manual-order>div{display:grid}.advisor-manual-order article{''',
    '''      .advisor-empty-preview{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:28px}.advisor-empty-preview span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.1em}.advisor-empty-preview h3{margin:6px 0;font-size:27px}.advisor-empty-preview p{margin:0;color:#64748b}.advisor-impact{display:grid!important;grid-template-columns:repeat(4,1fr);gap:1px;overflow:hidden;padding:0!important}.advisor-impact div{padding:14px 16px;background:#fff}.advisor-impact span,.advisor-impact strong{display:block}.advisor-impact span{color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.advisor-impact strong{margin-top:4px;color:#173a2c}
      .advisor-smart-route{display:grid!important;grid-template-columns:minmax(0,1.15fr) minmax(280px,1fr) auto;gap:16px;align-items:end;padding:18px}.advisor-smart-route h3{margin:5px 0 4px;color:#173a2c}.advisor-smart-route p{margin:0;color:#64748b;font-size:12px;line-height:1.45}.advisor-smart-route label{display:grid;gap:6px}.advisor-smart-route label>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.advisor-smart-route input{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c}.advisor-smart-route .btn{min-height:48px;white-space:nowrap}
      .advisor-manual-order{overflow:hidden}.advisor-manual-order>header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px;border-bottom:1px solid #e7eeea}.advisor-manual-order header span{color:#0b7655}.advisor-manual-order h3{margin:4px 0 0}.advisor-manual-summary{display:flex;align-items:center;justify-content:flex-end;gap:12px}.advisor-manual-order header small{max-width:390px;color:#64748b;text-align:right}.advisor-manual-summary>button{display:inline-flex;align-items:center;gap:7px;min-height:40px;border:1px solid #cbdad2;border-radius:10px;background:#fff;padding:0 12px;color:#173a2c;font-weight:900;cursor:pointer}.advisor-manual-summary>button i{color:#0b7655;font-size:10px;font-style:normal}.advisor-manual-order>div{display:grid}.advisor-manual-order article{''',
)

replace_once(
    panel,
    '''      @media(max-width:1150px){.advisor-reopen{grid-template-columns:1fr 1fr}.advisor-controls{grid-template-columns:1fr 1fr}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}
      @media(max-width:760px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar,.advisor-manual-order>header{align-items:stretch;flex-direction:column}.advisor-controls,.advisor-reopen,.advisor-impact{grid-template-columns:1fr!important}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}.advisor-manual-order article{grid-template-columns:34px 1fr}.advisor-manual-order article>div{grid-column:1/-1;flex-wrap:wrap}.advisor-removed>div{grid-template-columns:1fr}}''',
    '''      @media(max-width:1150px){.advisor-reopen{grid-template-columns:1fr 1fr}.advisor-controls{grid-template-columns:1fr 1fr}.advisor-smart-route{grid-template-columns:1fr 1fr!important}.advisor-smart-route>div{grid-column:1/-1}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}
      @media(max-width:760px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar,.advisor-manual-order>header{align-items:stretch;flex-direction:column}.advisor-controls,.advisor-reopen,.advisor-impact,.advisor-smart-route{grid-template-columns:1fr!important}.advisor-smart-route>div{grid-column:auto}.advisor-smart-route .btn{width:100%}.advisor-manual-summary{align-items:stretch;flex-direction:column}.advisor-manual-order header small{text-align:left}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}.advisor-manual-order article{grid-template-columns:34px 1fr}.advisor-manual-order article>div{grid-column:1/-1;flex-wrap:wrap}.advisor-removed>div{grid-template-columns:1fr}}''',
)

api = "app/api/admin/route-advisor/route.ts"

replace_once(
    api,
    'import { createClient } from "@supabase/supabase-js";\n',
    'import { createClient } from "@supabase/supabase-js";\nimport { verifyCanonicalRoutePersistence } from "@/lib/routes/verifyCanonicalRoutePersistence";\n',
)

replace_once(
    api,
    '''function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function rpcError(message?: string) {''',
    '''function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rpcError(message?: string) {''',
)

replace_once(
    api,
    '  if (/publish_canonical_route_daily|schema cache|could not find the function/i.test(value)) {',
    '  if (/publish_canonical_route_daily|apply_canonical_route_order_v2_service|schema cache|could not find the function/i.test(value)) {',
)

replace_once(
    api,
    '  return { service, user: userClient(token), companyId };',
    '  return { service, user: userClient(token), companyId, profileId: String(profile.id) };',
)

replace_once(
    api,
    '    const { service, user, companyId } = await requireAdmin(request);',
    '    const { service, user, companyId, profileId } = await requireAdmin(request);',
)

replace_once(
    api,
    '''      sourceVisitIds?: string[];
      visitId?: string;''',
    '''      sourceVisitIds?: string[];
      origin?: {
        label?: string;
        latitude?: number | null;
        longitude?: number | null;
      } | null;
      visitId?: string;''',
)

replace_once(
    api,
    '''    if (!employeeId || !crewId) throw new Error("Choose a canonical Employee and Crew.");
    if (!routeDate) throw new Error("Choose a route date.");
    if (!orderedJobIds.length) throw new Error("Keep at least one house in the route preview.");

    const moveSourceIds = await sourceVisitIdsForMove(service, companyId, body.removeFrom);''',
    '''    if (!employeeId || !crewId) throw new Error("Choose a canonical Employee and Crew.");
    if (!routeDate) throw new Error("Choose a route date.");
    if (!orderedJobIds.length) throw new Error("Keep at least one house in the route preview.");

    const originLabel = String(body.origin?.label || "Route start").trim() || "Route start";
    const originLatitude = Number(body.origin?.latitude);
    const originLongitude = Number(body.origin?.longitude);
    if (!Number.isFinite(originLatitude) || !Number.isFinite(originLongitude)) {
      throw new Error("Generate a valid Smart Route start point before publishing.");
    }

    const moveSourceIds = await sourceVisitIdsForMove(service, companyId, body.removeFrom);''',
)

replace_once(
    api,
    '''    const canonical = await materializePublishedRoute({
      service,
      companyId,
      routeId,
      routeDate,
      employeeId,
      crewId,
      orderedJobIds,
    });

    return NextResponse.json({
      ...data,
      routeId,
      routeVersion: canonical.routeVersion,
      orderedVisitIds: canonical.orderedVisitIds,
      count: canonical.count,
      canonicalVerified: true,
    });''',
    '''    const canonical = await materializePublishedRoute({
      service,
      companyId,
      routeId,
      routeDate,
      employeeId,
      crewId,
      orderedJobIds,
    });

    const applied = await service.rpc("apply_canonical_route_order_v2_service", {
      p_route_id: routeId,
      p_ordered_visit_ids: canonical.orderedVisitIds,
      p_origin_label: originLabel,
      p_origin_latitude: originLatitude,
      p_origin_longitude: originLongitude,
      p_expected_version: canonical.routeVersion,
      p_actor_profile_id: profileId,
      p_source: "admin_route_advisor_smart_route",
    });
    if (applied.error) throw rpcError(applied.error.message);

    const appliedData = applied.data || {};
    const appliedOrder = Array.isArray(appliedData.appliedOrder)
      ? appliedData.appliedOrder.map(String)
      : Array.isArray(appliedData.applied_order)
        ? appliedData.applied_order.map(String)
        : [];
    const appliedVersion = Number(appliedData.version || appliedData.routeVersion || 0);
    if (!sameOrder(appliedOrder, canonical.orderedVisitIds) || !Number.isInteger(appliedVersion) || appliedVersion < 1) {
      throw new Error("The database did not confirm the Smart Route order and version.");
    }

    const verified = await verifyCanonicalRoutePersistence(service, {
      routeId,
      orderedVisitIds: canonical.orderedVisitIds,
      routeVersion: appliedVersion,
      origin: {
        label: originLabel,
        latitude: originLatitude,
        longitude: originLongitude,
      },
    });

    return NextResponse.json({
      ...data,
      routeId,
      routeVersion: verified.routeVersion,
      orderedVisitIds: verified.orderedVisitIds,
      origin: verified.origin,
      count: verified.orderedVisitIds.length,
      canonicalVerified: true,
      smartRouteSaved: true,
    });''',
)

validation = "scripts/validate-canonical-map-sync.mjs"

replace_once(
    validation,
    '''const employeeMobile = read("app/mobile/employee/page.tsx");
''',
    '''const employeeMobile = read("app/mobile/employee/page.tsx");
const adminRouteAdvisorPanel = read("components/admin/RouteAdvisorPanel.tsx");
const adminRouteAdvisorApi = read("app/api/admin/route-advisor/route.ts");
''',
)

replace_once(
    validation,
    '''for (const [label, source] of [["Employee web", employeeWeb], ["Employee mobile", employeeMobile]]) {
  assert.match(source, /loadEmployeeRouteMapContext|useCanonicalRouteSnapshot/, `${label} list must use the canonical route service.`);
}

assert.doesNotMatch(demoSandbox,''',
    '''for (const [label, source] of [["Employee web", employeeWeb], ["Employee mobile", employeeMobile]]) {
  assert.match(source, /loadEmployeeRouteMapContext|useCanonicalRouteSnapshot/, `${label} list must use the canonical route service.`);
}

assert.match(adminRouteAdvisorPanel, /SMART ROUTE/, "Route Advisor web must expose the professional Smart Route panel.");
assert.match(adminRouteAdvisorPanel, /smartRouteAddress/, "Route Advisor must accept a route-specific start address.");
assert.match(adminRouteAdvisorPanel, /Recalculate Smart Route/, "An existing preview must support Smart Route recalculation.");
assert.match(adminRouteAdvisorPanel, /manualOrderOpen/, "Manual Route Order must be collapsible.");
assert.match(adminRouteAdvisorPanel, /aria-expanded=\{manualOrderOpen\}/, "The Manual Route Order disclosure must be accessible.");
assert.match(adminRouteAdvisorPanel, /origin:\s*\{\s*label:\s*smartRouteAddress/, "Publishing must send the reviewed Smart Route origin.");
assert.match(adminRouteAdvisorApi, /apply_canonical_route_order_v2_service/, "Route Advisor publish must finish through the canonical route writer.");
assert.match(adminRouteAdvisorApi, /verifyCanonicalRoutePersistence/, "Route Advisor must verify order, version and origin after publishing.");
assert.match(adminRouteAdvisorApi, /p_origin_label:\s*originLabel/, "The route-specific start point must persist with the canonical route version.");

assert.doesNotMatch(demoSandbox,''',
)

print("Admin Smart Route web patch applied")
