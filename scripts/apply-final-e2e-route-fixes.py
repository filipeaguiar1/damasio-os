from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/admin/operational-simulator/route.ts",
    '''  const customers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern);''',
    '''  const customers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern).is("archived_at", null);''',
)

replace_once(
    "app/api/admin/operational-simulator/route.ts",
    '''  if (visitIds.length) await remove("visit photos", service.from("photos").delete().in("visit_id", visitIds));
  if (propertyIds.length) await remove("property photos", service.from("photos").delete().in("property_id", propertyIds));''',
    '''  // Every simulator Photo is linked to its Property as well as its Visit. Deleting by
  // Property keeps the request bounded and avoids oversized Visit-ID filters after legacy runs.
  if (propertyIds.length) await remove("property photos", service.from("photos").delete().in("property_id", propertyIds));''',
)

replace_once(
    "app/api/map/canonical-route/route.ts",
    '''async function roadGeometry(routeId: string, routeVersion: number, points: Point[]) {
  if (points.length < 2) return null;
  const signature = `${routeId}:${routeVersion}:${points.map(point => `${point.longitude},${point.latitude}`).join(";")}`;
  const cached = geometryCache.get(signature);
  if (cached && cached.expiresAt > Date.now()) return cached.geometry;

  const encoded = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`,
    {
      headers: { Accept: "application/json", "User-Agent": "DamasioOS/CanonicalRouteSnapshot" },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  const result = await response.json() as { code?: string; routes?: Array<{ geometry?: RouteLineString }> };
  const geometry = result.code === "Ok" ? result.routes?.[0]?.geometry || null : null;
  geometryCache.set(signature, { geometry, expiresAt: Date.now() + 60_000 });
  return geometry;
}''',
    '''async function roadGeometry(routeId: string, routeVersion: number, points: Point[]) {
  if (points.length < 2) return null;
  const signature = `${routeId}:${routeVersion}:${points.map(point => `${point.longitude},${point.latitude}`).join(";")}`;
  const cached = geometryCache.get(signature);
  if (cached && cached.expiresAt > Date.now()) return cached.geometry;

  // The canonical snapshot must always include drawable geometry when every stop
  // is mapped. OSRM supplies the road-following line; a deterministic LineString
  // keeps all four screens usable during a transient routing-provider outage.
  const fallback: RouteLineString = {
    type: "LineString",
    coordinates: points.map(point => [point.longitude, point.latitude]),
  };
  let geometry: RouteLineString = fallback;
  try {
    const encoded = points.map(point => `${point.longitude},${point.latitude}`).join(";");
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`,
      {
        headers: { Accept: "application/json", "User-Agent": "DamasioOS/CanonicalRouteSnapshot" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) {
      const result = await response.json() as { code?: string; routes?: Array<{ geometry?: RouteLineString }> };
      if (result.code === "Ok" && result.routes?.[0]?.geometry?.coordinates?.length) {
        geometry = result.routes[0].geometry;
      }
    }
  } catch {
    // Keep the deterministic fallback. A provider outage cannot blank the Route.
  }
  geometryCache.set(signature, { geometry, expiresAt: Date.now() + 60_000 });
  return geometry;
}''',
)

replace_once(
    "tests/operational-simulator.spec.ts",
    '''  await expect(employee.getByText(/^(Active|IN PROGRESS)$/i).first()).toBeVisible({ timeout: 30_000 });
  employee.once("dialog", dialog => dialog.accept());
  await employee.getByRole("button", { name: "Finish" }).click();''',
    '''  const finish = employee.getByRole("button", { name: "Finish" });
  await expect(finish).toBeEnabled({ timeout: 30_000 });
  employee.once("dialog", dialog => dialog.accept());
  await finish.click();''',
)

print("Final route E2E fixes applied.")
