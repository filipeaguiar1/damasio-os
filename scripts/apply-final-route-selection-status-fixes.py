from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/mobile/employee/route/route.ts",
    '''    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    ) as any;
    const transition = await transitionEmployeeVisitStatus(userClient, String(body.visitId), body.status, profileId);''',
    '''    // Ownership and role were already verified above. Execute the canonical Visit
    // transition with the trusted server client so a valid Employee action cannot be
    // silently queued because of a legacy browser-role DELETE/UPDATE policy mismatch.
    const transition = await transitionEmployeeVisitStatus(service, String(body.visitId), body.status, profileId);''',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''    {!selectedEmployee ? <div className={`${styles.overviewMap} studio-map real-map official-route-overview`}>
      <div ref={mapNode} className="studio-preview-leaflet" />
    </div> : <div className={`${styles.focusedRoute} official-route-focused`}>''',
    '''    {!selectedEmployee ? <>
      <div className={`${styles.overviewMap} studio-map real-map official-route-overview`}>
        <div ref={mapNode} className="studio-preview-leaflet" />
      </div>
      <div className="official-route-worker-list" aria-label="Published employee routes" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
        {employees.map(employee => <button
          type="button"
          key={employee.id}
          className="official-route-worker-button studio-route-stop"
          data-employee-id={employee.id}
          onClick={() => {
            setSelectedHome(null);
            setCustomerRecord(null);
            setCustomerMessage("");
            setSelectedId(employee.id);
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, padding: "10px 12px" }}
        >
          <strong>{employee.name}</strong>
          <span>{counts.get(employee.id) || 0} house{(counts.get(employee.id) || 0) === 1 ? "" : "s"}</span>
        </button>)}
      </div>
    </> : <div className={`${styles.focusedRoute} official-route-focused`}>''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  const workerMarker = adminDesktop.locator(`.studio-leaflet-crew[title="${worker.name}"]`).first();
  await expect(workerMarker).toBeVisible({ timeout: 30_000 });
  await workerMarker.click();''',
    '''  const workerRouteButton = adminDesktop.locator(`.official-route-worker-button[data-employee-id="${worker.id}"]`);
  await expect(workerRouteButton).toBeVisible({ timeout: 30_000 });
  await expect(workerRouteButton).toContainText(String(employeeSnapshot.stops.length));
  await workerRouteButton.click();''',
)

print("Final route selection and status fixes applied.")
