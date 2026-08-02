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
    '''    if (result.error) {
      if (!missingMigration(result.error.message)) throw new Error(result.error.message);
      const visit = await fallbackVisitTransition({
        service,
        employee,
        userId,
        companyId,
        visitId,
        action,
        reason,
      });
      return NextResponse.json({ visit, fallback: true });
    }''',
    '''    if (result.error) {
      // The API has already authenticated the Employee and verified the Visit belongs
      // to this Employee/company. Apply the same invariant-checked server fallback for
      // legacy RPC permissions as well as a missing migration; never pretend the action
      // succeeded by leaving it only in a browser queue.
      console.warn("employee-route-rpc-fallback", { visitId, action, message: result.error.message });
      const visit = await fallbackVisitTransition({
        service,
        employee,
        userId,
        companyId,
        visitId,
        action,
        reason,
      });
      return NextResponse.json({ visit, fallback: true });
    }''',
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
