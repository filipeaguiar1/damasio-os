from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


# A route snapshot may be resolved by routeId (Admin map) or by date (Employee web).
Path("lib/hooks/useCanonicalRouteSnapshot.ts").write_text('''"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  loadCanonicalRouteSnapshot,
  type CanonicalRouteSnapshot,
} from "@/lib/routes/canonicalRouteSnapshot";

type CanonicalRouteTarget = string | {
  routeId?: string | null;
  routeDate?: string | null;
};

function targetValues(target?: CanonicalRouteTarget) {
  if (typeof target === "string") {
    return { requestedRouteId: target.trim() || null, routeDate: null };
  }
  return {
    requestedRouteId: String(target?.routeId || "").trim() || null,
    routeDate: String(target?.routeDate || "").trim() || null,
  };
}

export function useCanonicalRouteSnapshot(target?: CanonicalRouteTarget) {
  const { requestedRouteId, routeDate } = targetValues(target);
  const [resolvedRouteId, setResolvedRouteId] = useState<string | null>(requestedRouteId);
  const [snapshot, setSnapshot] = useState<CanonicalRouteSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(requestedRouteId || routeDate));
  const requestRef = useRef(0);
  const activeRouteId = requestedRouteId || resolvedRouteId;

  const refresh = useCallback(async () => {
    if (!requestedRouteId && !routeDate) {
      setResolvedRouteId(null);
      setSnapshot(null);
      setError("");
      setLoading(false);
      return null;
    }

    const request = ++requestRef.current;
    try {
      const next = await loadCanonicalRouteSnapshot({
        routeId: requestedRouteId,
        routeDate: requestedRouteId ? null : routeDate,
      });
      if (request !== requestRef.current) return null;
      setResolvedRouteId(next.routeId);
      setSnapshot(current => {
        if (current?.routeId === next.routeId && current.routeVersion > next.routeVersion) {
          return current;
        }
        return next;
      });
      setError("");
      return next;
    } catch (reason) {
      if (request === requestRef.current) {
        setError(reason instanceof Error ? reason.message : "Route synchronization failed.");
      }
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [requestedRouteId, routeDate]);

  useEffect(() => {
    requestRef.current += 1;
    setResolvedRouteId(requestedRouteId);
    setSnapshot(null);
    setError("");
    setLoading(Boolean(requestedRouteId || routeDate));
    if (!requestedRouteId && !routeDate) return;

    let disposed = false;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const updated = () => refreshCurrent();
    const visible = () => {
      if (document.visibilityState === "visible") refreshCurrent();
    };

    void refresh();
    const poll = window.setInterval(refreshCurrent, 5_000);
    window.addEventListener("focus", refreshCurrent);
    window.addEventListener("damasio:canonical-route-updated", updated);
    document.addEventListener("visibilitychange", visible);

    let broadcast: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      broadcast = new BroadcastChannel("damasio-canonical-route");
      broadcast.onmessage = () => refreshCurrent();
    }

    return () => {
      disposed = true;
      requestRef.current += 1;
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshCurrent);
      window.removeEventListener("damasio:canonical-route-updated", updated);
      document.removeEventListener("visibilitychange", visible);
      broadcast?.close();
    };
  }, [requestedRouteId, routeDate, refresh]);

  useEffect(() => {
    if (!activeRouteId) return;
    let disposed = false;
    const client = getSupabaseBrowserClient() as any;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const channel = client
      .channel(`canonical-route-version:${activeRouteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_order_state", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_stops", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .subscribe();

    return () => {
      disposed = true;
      void client.removeChannel(channel);
    };
  }, [activeRouteId, refresh]);

  return { snapshot, error, loading, routeId: activeRouteId, refresh };
}
''')

# Expose the one snapshot -> Employee context projection to every browser surface.
replace_once(
    "lib/services/routeMapService.ts",
    "function contextFromSnapshot(snapshot: CanonicalRouteSnapshot): EmployeeRouteMapContext {",
    "export function employeeRouteMapContextFromSnapshot(snapshot: CanonicalRouteSnapshot): EmployeeRouteMapContext {",
)
replace_once(
    "lib/services/routeMapService.ts",
    "  return contextFromSnapshot(snapshot);",
    "  return employeeRouteMapContextFromSnapshot(snapshot);",
)
replace_once(
    "lib/services/routeMapService.ts",
    "      if (response.ok) return result as Record<string, any>;",
    '''      if (response.ok) {
        const routeId = String(result.routeId || body.routeId || "");
        window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId } }));
        if (typeof BroadcastChannel !== "undefined") {
          const broadcast = new BroadcastChannel("damasio-canonical-route");
          broadcast.postMessage({ routeId, routeVersion: result.routeVersion || result.version || null });
          broadcast.close();
        }
        return result as Record<string, any>;
      }''',
)

# Employee web reads the canonical snapshot by date and receives route version changes immediately.
replace_once(
    "app/employee/route/page.tsx",
    'import { applyEmployeeRouteMapContext, loadEmployeeRouteMapContext, loadEmployeeRouteMapContextUntilStatus, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";',
    'import { applyEmployeeRouteMapContext, employeeRouteMapContextFromSnapshot, loadEmployeeRouteMapContextUntilStatus, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";\nimport { useCanonicalRouteSnapshot } from "@/lib/hooks/useCanonicalRouteSnapshot";',
)
replace_once(
    "app/employee/route/page.tsx",
    '''  useEffect(()=>{
    let cancelled=false;
    if(!selectedDate||!crew)return()=>{cancelled=true};
    const loadContext=()=>void loadEmployeeRouteMapContext(selectedDate,crew)
      .then(context=>{if(!cancelled)acceptCanonicalContext(context)})
      .catch(error=>{if(!cancelled)setMenuMessage(error instanceof Error?error.message:"Route synchronization is temporarily unavailable.")});
    const loadVisible=()=>{if(document.visibilityState==="visible")loadContext()};
    loadContext();
    const timer=window.setInterval(loadContext,5_000);
    window.addEventListener("focus",loadVisible);
    document.addEventListener("visibilitychange",loadVisible);
    return()=>{
      cancelled=true;
      window.clearInterval(timer);
      window.removeEventListener("focus",loadVisible);
      document.removeEventListener("visibilitychange",loadVisible);
    };
  },[selectedDate,crew]);''',
    '''  const {snapshot:liveRouteSnapshot,error:liveRouteError}=useCanonicalRouteSnapshot({routeDate:selectedDate});
  useEffect(()=>{
    if(liveRouteSnapshot)acceptCanonicalContext(employeeRouteMapContextFromSnapshot(liveRouteSnapshot));
  },[liveRouteSnapshot]);
  useEffect(()=>{
    if(liveRouteError&&!/not found|no canonical route/i.test(liveRouteError))setMenuMessage(liveRouteError);
  },[liveRouteError]);''',
)

# Route Advisor now edits the exact snapshot that Employee mobile published.
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    'import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";',
    'import { canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";\nimport { useCanonicalRouteSnapshot } from "@/lib/hooks/useCanonicalRouteSnapshot";\nimport type { CanonicalRouteSnapshot } from "@/lib/routes/canonicalRouteSnapshot";',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '''async function locate(home: RouteLead) {
  if (Number.isFinite(home.latitude) && Number.isFinite(home.longitude)) {
    return { ...home, latitude: Number(home.latitude), longitude: Number(home.longitude) };
  }
  const point = await geocode(home.address);
  return { ...home, ...point };
}
''',
    '''async function locate(home: RouteLead) {
  if (Number.isFinite(home.latitude) && Number.isFinite(home.longitude)) {
    return { ...home, latitude: Number(home.latitude), longitude: Number(home.longitude) };
  }
  const point = await geocode(home.address);
  return { ...home, ...point };
}

function routeLeadsFromSnapshot(snapshot: CanonicalRouteSnapshot | null): RouteLead[] {
  if (!snapshot) return [];
  return snapshot.stops.map(stop => ({
    id: stop.visitId,
    createdAt: stop.scheduledDate ? `${stop.scheduledDate}T12:00:00.000Z` : snapshot.updatedAt,
    name: stop.customerName,
    phone: "",
    email: "",
    address: stop.address,
    service: stop.serviceName,
    status: stop.status === "completed" ? "completed" as const : "booked" as const,
    subtotal: 0,
    tax: 0,
    total: 0,
    photos: [],
    scheduledDate: stop.scheduledDate || snapshot.routeDate,
    nextVisitDate: stop.scheduledDate || snapshot.routeDate,
    routeOrder: stop.routeOrder,
    latitude: stop.latitude ?? undefined,
    longitude: stop.longitude ?? undefined,
    canonicalVisitId: stop.visitId,
    canonicalJobId: stop.jobId || undefined,
    canonicalRouteId: snapshot.routeId,
    canonicalCustomerId: stop.customerId || undefined,
    canonicalPropertyId: stop.propertyId || undefined,
    canonicalEmployeeId: stop.employeeId || undefined,
    canonicalCrewId: stop.crewId || undefined,
    canonicalVisitStatus: stop.status as RouteLead["canonicalVisitStatus"],
    visitStartedAt: stop.startedAt || undefined,
    visitFinishedAt: stop.finishedAt || undefined,
    visitDurationSeconds: stop.durationSeconds ?? undefined,
  }));
}
''',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '        fetch("/api/admin/routes", { headers, cache: "no-store" }),',
    '        fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, { headers, cache: "no-store" }),',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    "  }, []);\n\n  useEffect(() => {\n    void refresh();",
    "  }, [date]);\n\n  useEffect(() => {\n    void refresh();",
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '''  const currentRoute = useMemo(() => {
    if (!employeeIdentity) return [];
    return visits
      .filter(item =>
        item.scheduledDate === date
        && belongsToCanonicalEmployee(item, employeeIdentity))
      .sort((left, right) =>
        (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
        || canonicalVisitId(left).localeCompare(canonicalVisitId(right)));
  }, [visits, date, employeeIdentity?.id, employeeIdentity?.crewId]);
''',
    '''  const routeCandidates = useMemo(() => {
    if (!employeeIdentity) return [];
    const datedVisits = visits.filter(item => item.scheduledDate === date);
    return canonicalRouteLeadsForEmployee(datedVisits, employeeIdentity)
      .sort((left, right) =>
        (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
        || canonicalVisitId(left).localeCompare(canonicalVisitId(right)));
  }, [visits, date, employeeIdentity?.id, employeeIdentity?.crewId]);
  const currentRouteId = routeCandidates[0]?.canonicalRouteId || null;
  const {
    snapshot: liveRouteSnapshot,
    error: liveRouteError,
    refresh: refreshLiveRoute,
  } = useCanonicalRouteSnapshot(currentRouteId);
  const currentRoute = useMemo(() =>
    liveRouteSnapshot ? routeLeadsFromSnapshot(liveRouteSnapshot) : routeCandidates,
  [liveRouteSnapshot, routeCandidates]);

  useEffect(() => {
    if (liveRouteError) setMessage(liveRouteError);
  }, [liveRouteError]);
''',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '''      setMessage(`${result.count} houses published for ${employee.name} on ${date}. Capacity ${result.count}/${result.capacity}.`);
      setSelectedJobIds([]);
      setRecommendations([]);
      resetPreview();
      await refresh(true);''',
    '''      const routeVersion = Number(result.routeVersion || result.routeVersions?.[result.routeId] || 0);
      setMessage(`${result.count} houses published for ${employee.name} on ${date}${routeVersion ? ` as canonical route v${routeVersion}` : ""}. Admin and Employee web/mobile update automatically.`);
      setSelectedJobIds([]);
      setRecommendations([]);
      resetPreview();
      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId: result.routeId } }));
      if (typeof BroadcastChannel !== "undefined") {
        const broadcast = new BroadcastChannel("damasio-canonical-route");
        broadcast.postMessage({ routeId: result.routeId, routeVersion });
        broadcast.close();
      }
      await refresh(true);
      if (result.routeId === currentRouteId) await refreshLiveRoute();''',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '<h2>Intelligent suggestion. Full Admin control.</h2>\n        <p>Proximity, capacity, displacement, Employee continuity and due date guide the recommendation. Nothing publishes automatically.</p>',
    '<h2>Create, add, reorder or remove houses.</h2>\n        <p>The Advisor edits the same versioned canonical Route used by Admin and Employee on web and mobile. Nothing publishes automatically.</p>',
)
replace_once(
    "components/admin/RouteAdvisorPanel.tsx",
    '{busy ? "Calculating..." : "Generate route preview"}',
    '{busy ? "Calculating..." : currentRoute.length ? "Edit current canonical route" : "Create route preview"}',
)

# Admin route list/count refreshes immediately when membership changes.
replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [date]);''',
    '''  useEffect(() => {
    void refresh();
    const client = getSupabaseBrowserClient() as any;
    let refreshTimer = 0;
    const refreshSoon = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 120);
    };
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => { if (document.visibilityState === "visible") refreshSoon(); };
    const channel = client
      .channel(`admin-canonical-routes:${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_order_state" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_stops" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, refreshSoon)
      .subscribe();
    window.addEventListener("damasio:canonical-route-updated", refreshSoon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(timer);
      window.removeEventListener("damasio:canonical-route-updated", refreshSoon);
      document.removeEventListener("visibilitychange", onVisible);
      void client.removeChannel(channel);
    };
  }, [date]);''',
)

# Move mode also resolves one route by routeId instead of splitting duplicate Employee aliases.
replace_once(
    "components/admin/RouteStudio.tsx",
    'import { belongsToCanonicalEmployee, canonicalRouteWarnings } from "@/lib/routes/canonicalRouteIdentity";',
    'import { canonicalRouteLeadsForEmployee, canonicalRouteWarnings } from "@/lib/routes/canonicalRouteIdentity";',
)
replace_once(
    "components/admin/RouteStudio.tsx",
    '''  const sourceRoute = useMemo(() => sourceIdentity ? visits.filter(item =>
    item.scheduledDate === date && belongsToCanonicalEmployee(item, sourceIdentity))
    .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)) : [],
  [visits, date, sourceIdentity?.id, sourceIdentity?.crewId]);''',
    '''  const sourceRoute = useMemo(() => sourceIdentity
    ? canonicalRouteLeadsForEmployee(
        visits.filter(item => item.scheduledDate === date),
        sourceIdentity,
      ).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999))
    : [],
  [visits, date, sourceIdentity?.id, sourceIdentity?.crewId]);''',
)

# Return the resulting canonical version to the Advisor UI.
replace_once(
    "app/api/admin/route-advisor/route.ts",
    '''    if (result.error) throw rpcError(result.error.message);
    return NextResponse.json(result.data);''',
    '''    if (result.error) throw rpcError(result.error.message);
    const data = result.data || {};
    const routeId = String(data.routeId || "");
    const routeVersion = Number(data.routeVersions?.[routeId] || data.routeVersion || 0);
    return NextResponse.json({ ...data, routeVersion });''',
)

# Extend the authenticated gate with Admin membership remove/add through Route Advisor.
replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  const restoredEmployee = await authRequest<any>(employeeDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  expect(restoredEmployee.orderedVisitIds).toEqual(employeeSnapshot.orderedVisitIds);

  await adminDesktop.screenshot({ path: "canonical-admin-web.png", fullPage: true });''',
    '''  const restoredEmployee = await authRequest<any>(employeeDesktop, `/api/map/canonical-route?routeId=${employeeSnapshot.routeId}`);
  expect(restoredEmployee.orderedVisitIds).toEqual(employeeSnapshot.orderedVisitIds);

  const originalJobIds = restoredEmployee.stops.map((stop: any) => String(stop.jobId || "")).filter(Boolean);
  expect(originalJobIds.length).toBe(restoredEmployee.stops.length);
  const reducedJobIds = originalJobIds.slice(0, -1);
  const adminRemove = await authRequest<any>(adminDesktop, "/api/admin/route-advisor", {
    method: "POST",
    body: {
      action: "publish",
      employeeId: worker.employeeId || worker.id,
      crewId: worker.crewId,
      routeDate,
      orderedJobIds: reducedJobIds,
      sourceVisitIds: [],
    },
  });
  expect(adminRemove.count).toBe(reducedJobIds.length);
  expect(adminRemove.routeVersion).toBeGreaterThan(restoredEmployee.routeVersion);
  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, adminRemove.routeVersion);
  }
  for (const [page, label] of [
    [adminDesktop, "Admin web after Advisor remove"],
    [adminMobile, "Admin mobile after Advisor remove"],
    [employeeDesktop, "Employee web after Advisor remove"],
    [employeeMobile, "Employee mobile after Advisor remove"],
  ] as const) {
    await assertCanonicalScreen(page, adminRemove.routeVersion, reducedJobIds.length, label);
  }

  const adminAdd = await authRequest<any>(adminDesktop, "/api/admin/route-advisor", {
    method: "POST",
    body: {
      action: "publish",
      employeeId: worker.employeeId || worker.id,
      crewId: worker.crewId,
      routeDate,
      orderedJobIds: originalJobIds,
      sourceVisitIds: [],
    },
  });
  expect(adminAdd.count).toBe(originalJobIds.length);
  expect(adminAdd.routeVersion).toBeGreaterThan(adminRemove.routeVersion);
  for (const page of [adminDesktop, adminMobile, employeeDesktop, employeeMobile]) {
    await waitForVersion(page, employeeSnapshot.routeId, adminAdd.routeVersion);
  }
  for (const [page, label] of [
    [adminDesktop, "Admin web after Advisor add"],
    [adminMobile, "Admin mobile after Advisor add"],
    [employeeDesktop, "Employee web after Advisor add"],
    [employeeMobile, "Employee mobile after Advisor add"],
  ] as const) {
    await assertCanonicalScreen(page, adminAdd.routeVersion, originalJobIds.length, label);
  }

  await adminDesktop.screenshot({ path: "canonical-admin-web.png", fullPage: true });''',
)
replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  await employeeMobile.screenshot({ path: "canonical-employee-mobile.png", fullPage: true });

  await authRequest(adminDesktop, "/api/admin/operational-simulator", {''',
    '''  await employeeMobile.screenshot({ path: "canonical-employee-mobile.png", fullPage: true });

  await adminDesktop.goto(`${baseURL}/admin/routes?tab=advisor`);
  await expect(adminDesktop.getByText("Create, add, reorder or remove houses.")).toBeVisible({ timeout: 30_000 });
  await adminDesktop.locator(".advisor-controls select").selectOption(worker.id);
  await adminDesktop.locator('.advisor-controls input[type="date"]').fill(routeDate);
  await expect(adminDesktop.locator(".advisor-house-picker")).toContainText(`route ${originalJobIds.length}/`, { timeout: 30_000 });

  await authRequest(adminDesktop, "/api/admin/operational-simulator", {''',
)
