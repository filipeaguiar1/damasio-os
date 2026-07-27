"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InteractiveRoutePreviewMap } from "@/components/admin/InteractiveRoutePreviewMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";
import {
  planningDates,
  recommendRoutePlacements,
  type AdvisorPoint,
  type RouteAdvisorRecommendation,
} from "@/lib/routes/routeAdvisor";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
  dailyCapacity: number;
};

type AdminEmployee = {
  id: string;
  daily_route_capacity?: number | null;
};

type Origin = AdvisorPoint & { label: string };

const coordinateCache = new Map<string, AdvisorPoint>();

function canonicalJobId(home: RouteLead) {
  return home.canonicalJobId || home.id;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function geocode(address: string) {
  const key = address.trim().toLowerCase();
  const cached = coordinateCache.get(key);
  if (cached) return cached;
  const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Address could not be mapped: ${address}`);
  const point = await response.json() as AdvisorPoint;
  coordinateCache.set(key, point);
  return point;
}

async function locate(home: RouteLead) {
  if (Number.isFinite(home.latitude) && Number.isFinite(home.longitude)) {
    return { ...home, latitude: Number(home.latitude), longitude: Number(home.longitude) };
  }
  const point = await geocode(home.address);
  return { ...home, ...point };
}

export function RouteAdvisorPanel() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [excludedCurrentJobIds, setExcludedCurrentJobIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(operationalDateKey());
  const [query, setQuery] = useState("");
  const [recommendations, setRecommendations] = useState<RouteAdvisorRecommendation[]>([]);
  const [preview, setPreview] = useState<RouteLead[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [lockedJobIds, setLockedJobIds] = useState<string[]>([]);
  const [message, setMessage] = useState("Loading route data...");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await accessToken();
      const headers = { authorization: `Bearer ${token}` };
      const [routeResponse, employeeResponse] = await Promise.all([
        fetch("/api/admin/routes", { headers, cache: "no-store" }),
        fetch("/api/admin/users", { headers, cache: "no-store" }),
      ]);
      const routeResult = await routeResponse.json();
      const employeeResult = await employeeResponse.json().catch(() => ({ users: [] }));
      if (!routeResponse.ok) throw new Error(routeResult.error || "Routes could not be loaded.");
      const profiles = new Map<string, AdminEmployee>((employeeResult.users || []).map((item: AdminEmployee) => [item.id, item]));
      const realEmployees: RouteEmployee[] = (routeResult.employees || []).map((item: Omit<RouteEmployee, "dailyCapacity">) => ({
        ...item,
        dailyCapacity: Math.max(1, Number(profiles.get(item.id)?.daily_route_capacity || 16)),
      }));
      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads((routeResult.board || {}) as SchedulingDispatchBoard));
      setEmployeeId(current => realEmployees.some(item => item.id === current) ? current : realEmployees[0]?.id || "");
      if (!silent) setMessage(realEmployees.length ? "" : "Add an active Employee before planning routes.");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Route data could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const jobs = useMemo(() => leads.filter(item => !item.canonicalVisitId), [leads]);
  const visits = useMemo(() => leads.filter(item => Boolean(item.canonicalVisitId)), [leads]);
  const employee = employees.find(item => item.id === employeeId) || null;
  const employeeIdentity = employee ? { id: employee.employeeId || employee.id, crewId: employee.crewId } : null;
  const excluded = useMemo(() => new Set(excludedCurrentJobIds), [excludedCurrentJobIds]);
  const selected = useMemo(() => new Set(selectedJobIds), [selectedJobIds]);

  const currentRoute = useMemo(() => {
    if (!employeeIdentity) return [];
    return visits
      .filter(item => item.scheduledDate === date && belongsToCanonicalEmployee(item, employeeIdentity))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999));
  }, [visits, date, employeeIdentity?.id, employeeIdentity?.crewId]);

  const normalized = query.trim().toLowerCase();
  const visibleJobs = useMemo(() => jobs
    .filter(item => !normalized || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized))
    .sort((a, b) => (a.nextVisitDate || "9999").localeCompare(b.nextVisitDate || "9999") || a.address.localeCompare(b.address)),
  [jobs, normalized]);
  const selectedHomes = useMemo(() => jobs.filter(item => selected.has(canonicalJobId(item))), [jobs, selected]);

  function resetPreview() {
    setPreview([]);
    setOrigin(null);
    setLockedJobIds([]);
  }

  function toggleJob(home: RouteLead) {
    const id = canonicalJobId(home);
    setSelectedJobIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setExcludedCurrentJobIds(current => current.filter(value => value !== id));
    setRecommendations([]);
    resetPreview();
  }

  function changeEmployee(next: string) {
    setEmployeeId(next);
    setExcludedCurrentJobIds([]);
    setRecommendations([]);
    resetPreview();
  }

  function changeDate(next: string) {
    setDate(next);
    setExcludedCurrentJobIds([]);
    setRecommendations([]);
    resetPreview();
  }

  async function recommend() {
    if (!selectedHomes.length) {
      setMessage("Select at least one house for the Advisor to place.");
      return;
    }
    setBusy(true);
    setMessage("Comparing regions, due dates and each Employee's configured capacity...");
    try {
      const days = new Set(planningDates(date, 7));
      const locatedEmployees = await Promise.all(employees.map(async worker => ({
        id: worker.id,
        employeeId: worker.employeeId,
        crewId: worker.crewId,
        name: worker.name,
        dailyCapacity: worker.dailyCapacity,
        start: worker.routeStartAddress ? await geocode(worker.routeStartAddress).catch(() => null) : null,
      })));
      const locatedHomes = await Promise.all(selectedHomes.map(async home => {
        const mapped = await locate(home);
        return {
          id: canonicalJobId(home),
          crewId: home.canonicalCrewId,
          nextVisitDate: home.nextVisitDate,
          point: { latitude: Number(mapped.latitude), longitude: Number(mapped.longitude) },
        };
      }));
      const planningVisits = visits.filter(item => item.scheduledDate && days.has(item.scheduledDate));
      const locatedVisits = await Promise.all(planningVisits.map(async visit => {
        const mapped = await locate(visit).catch(() => null);
        return {
          jobId: canonicalJobId(visit),
          date: visit.scheduledDate || date,
          employeeId: visit.canonicalEmployeeId,
          crewId: visit.canonicalCrewId,
          status: visit.canonicalVisitStatus,
          point: mapped ? { latitude: Number(mapped.latitude), longitude: Number(mapped.longitude) } : null,
        };
      }));
      const result = recommendRoutePlacements({
        employees: locatedEmployees,
        homes: locatedHomes,
        visits: locatedVisits,
        startDate: date,
        days: 7,
      });
      setRecommendations(result.slice(0, 6));
      setMessage(result.length
        ? "Recommendations are ready. Choose one or keep your own Employee and date. Nothing is published automatically."
        : "No Employee has enough configured capacity in the next seven days for these houses.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route recommendations could not be calculated.");
    } finally {
      setBusy(false);
    }
  }

  function applyRecommendation(item: RouteAdvisorRecommendation) {
    setEmployeeId(item.employeeId);
    setDate(item.date);
    setExcludedCurrentJobIds([]);
    resetPreview();
    setMessage(`${item.employeeName} on ${item.date} selected as a starting point. You can still change everything manually.`);
  }

  async function generatePreview() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!employee.routeStartAddress) {
      setMessage(`Save a default route start address in ${employee.name}'s profile first.`);
      return;
    }
    setBusy(true);
    setMessage("Mapping the selected route and calculating the driving order...");
    try {
      const currentByJob = new Map(currentRoute.map(item => [canonicalJobId(item), item]));
      const locked = currentRoute.filter(item => ["completed", "in_progress"].includes(item.canonicalVisitStatus || ""));
      const mutableCurrent = currentRoute.filter(item => !locked.includes(item) && !excluded.has(canonicalJobId(item)));
      const newHomes = selectedHomes.filter(item => !currentByJob.has(canonicalJobId(item)));
      const combinedByJob = new Map<string, RouteLead>();
      for (const home of [...locked, ...mutableCurrent, ...newHomes]) combinedByJob.set(canonicalJobId(home), home);
      const combined = [...combinedByJob.values()];
      if (!combined.length) {
        setMessage("Select houses or keep at least one existing route stop.");
        return;
      }
      if (combined.length > employee.dailyCapacity) {
        setMessage(`${employee.name}'s profile allows ${employee.dailyCapacity} houses per day. Remove ${combined.length - employee.dailyCapacity} before previewing.`);
        return;
      }
      const start = await geocode(employee.routeStartAddress);
      const mapped = await Promise.all(combined.map(locate));
      let ordered = [...mapped];
      if (mapped.length > 1) {
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: [start.longitude, start.latitude],
            coordinates: mapped.map(home => [Number(home.longitude), Number(home.latitude)]),
          }),
        });
        if (response.ok) {
          const result = await response.json() as { order: number[] };
          ordered = result.order.map(index => mapped[index]).filter(Boolean);
        }
      }
      setOrigin({ ...start, label: `${employee.name} start` });
      setLockedJobIds(locked.map(canonicalJobId));
      setPreview(ordered.map((home, index) => ({ ...home, routeOrder: index + 1 })));
      setMessage("Preview ready. Click any unlocked numbered house to remove it; the road line updates immediately.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route preview could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  const removeFromPreview = useCallback((home: RouteLead) => {
    const id = canonicalJobId(home);
    setPreview(current => current.filter(item => canonicalJobId(item) !== id).map((item, index) => ({ ...item, routeOrder: index + 1 })));
    setSelectedJobIds(current => current.filter(value => value !== id));
    if (currentRoute.some(item => canonicalJobId(item) === id)) {
      setExcludedCurrentJobIds(current => current.includes(id) ? current : [...current, id]);
    }
    setMessage(`${home.name} removed from the preview. Confirm only after the route looks right.`);
  }, [currentRoute]);

  async function publish() {
    if (!employee || !preview.length) return;
    setBusy(true);
    setMessage("Publishing the reviewed canonical route...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employeeId: employee.employeeId || employee.id,
          crewId: employee.crewId,
          routeDate: date,
          orderedJobIds: preview.map(canonicalJobId),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The route could not be published.");
      setMessage(`${result.count} houses published for ${employee.name} on ${date}. Capacity ${result.count}/${result.capacity}.`);
      setSelectedJobIds([]);
      setExcludedCurrentJobIds([]);
      setRecommendations([]);
      resetPreview();
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The route could not be published.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="advisor-shell">
    <header className="advisor-hero">
      <div><span>ROUTE ADVISOR</span><h2>Recommendation without dependency.</h2><p>The system suggests the strongest Employee and day by region, workload and due date. The company Admin keeps final control.</p></div>
      <div className="advisor-guard"><strong>Admin approval required</strong><small>No recommendation publishes itself.</small></div>
    </header>

    <section className="advisor-controls">
      <label><span>Employee</span><select value={employeeId} onChange={event => changeEmployee(event.target.value)}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dailyCapacity}/day</option>)}</select></label>
      <label><span>Route date</span><input type="date" value={date} onChange={event => changeDate(event.target.value)} /></label>
      <label><span>Search houses</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Customer, address or service" /></label>
      <button type="button" className="btn btn-outline" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Loading..." : "Refresh"}</button>
    </section>

    {message && <div className="desktop-route-message">{message}</div>}

    <section className="advisor-layout">
      <aside className="advisor-house-picker">
        <header><div><strong>Houses to place</strong><small>{selectedJobIds.length} selected · existing route {currentRoute.length}/{employee?.dailyCapacity || 0}</small></div><button type="button" onClick={() => { setSelectedJobIds([]); setExcludedCurrentJobIds([]); resetPreview(); }}>Clear</button></header>
        <div className="advisor-house-list">
          {visibleJobs.map((home, index) => {
            const id = canonicalJobId(home);
            const active = selected.has(id);
            return <button type="button" key={id} className={active ? "selected" : ""} onClick={() => toggleJob(home)}>
              <b>{index + 1}</b><span><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service} · due {home.nextVisitDate || "not set"}</small></span><em>{active ? "Selected" : home.canonicalCrewId ? "Assigned" : "Available"}</em>
            </button>;
          })}
          {!visibleJobs.length && <div className="desktop-route-empty"><strong>No matching active Jobs.</strong></div>}
        </div>
        <button type="button" className="btn btn-primary advisor-recommend" disabled={busy || !selectedHomes.length} onClick={() => void recommend()}>{busy ? "Analyzing..." : `Recommend Employee & day (${selectedHomes.length})`}</button>
      </aside>

      <main className="advisor-main">
        {recommendations.length > 0 && <section className="advisor-recommendations">
          <header><strong>Best regional fits</strong><span>Suggestions only — manual choice remains available.</span></header>
          <div>{recommendations.map((item, index) => <button type="button" key={`${item.employeeId}-${item.date}`} onClick={() => applyRecommendation(item)}>
            <b>#{index + 1}</b><span><strong>{item.employeeName} · {item.date}</strong><small>{item.existingStops + item.selectedStops}/{item.capacity} houses · +{item.estimatedExtraKm} km estimate</small><em>{item.reasons.join(" · ")}</em></span><i>{item.score}%</i>
          </button>)}</div>
        </section>}

        {!preview.length ? <section className="advisor-empty-preview">
          <div><span>MANUAL PREVIEW</span><h3>{employee ? `${employee.name} · ${date}` : "Choose an Employee"}</h3><p>{employee ? `Daily capacity from profile: ${employee.dailyCapacity} houses. Current route: ${currentRoute.length}.` : "The Admin can ignore recommendations and choose any valid Employee and date."}</p></div>
          <button type="button" className="btn btn-primary" disabled={busy || !employee} onClick={() => void generatePreview()}>{busy ? "Calculating..." : "Generate clickable preview"}</button>
        </section> : <>
          <InteractiveRoutePreviewMap route={preview} origin={origin} capacity={employee?.dailyCapacity || preview.length} lockedJobIds={lockedJobIds} onRemove={removeFromPreview} />
          <section className="advisor-publish-bar"><div><strong>{preview.length}/{employee?.dailyCapacity || preview.length} houses ready</strong><span>Green houses are completed or active and stay locked. Blue houses can be removed.</span></div><button type="button" className="btn btn-primary" disabled={busy || !preview.length} onClick={() => void publish()}>{busy ? "Publishing..." : "Confirm & publish route"}</button></section>
        </>}
      </main>
    </section>

    <style jsx global>{`
      .advisor-shell{display:grid;gap:18px}.advisor-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:26px;border-radius:24px;background:linear-gradient(135deg,#082f23,#0d6b47);color:#fff}.advisor-hero span{color:#9ce3b9;font-size:10px;font-weight:950;letter-spacing:.13em}.advisor-hero h2{margin:7px 0 6px;font-size:34px;letter-spacing:-.04em}.advisor-hero p{max-width:760px;margin:0;color:rgba(255,255,255,.7)}.advisor-guard{min-width:220px;padding:14px 16px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(255,255,255,.09)}.advisor-guard strong,.advisor-guard small{display:block}.advisor-guard small{margin-top:4px;color:rgba(255,255,255,.65)}
      .advisor-controls{display:grid;grid-template-columns:1fr 220px 1fr auto;gap:12px;align-items:end;padding:16px;border:1px solid #dbe7e1;border-radius:20px;background:#fff}.advisor-controls label{display:grid;gap:6px}.advisor-controls label>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.advisor-controls input,.advisor-controls select{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c}
      .advisor-layout{display:grid;grid-template-columns:minmax(320px,.72fr) minmax(0,1.45fr);gap:16px;align-items:start}.advisor-house-picker,.advisor-main>section,.advisor-recommendations{border:1px solid #dbe7e1;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.05)}.advisor-house-picker{overflow:hidden;position:sticky;top:16px}.advisor-house-picker>header,.advisor-recommendations>header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;border-bottom:1px solid #e7eeea}.advisor-house-picker header strong,.advisor-house-picker header small{display:block}.advisor-house-picker header small{margin-top:3px;color:#64748b}.advisor-house-picker header button{border:0;background:transparent;color:#0b7655;font-weight:900;cursor:pointer}.advisor-house-list{max-height:610px;overflow:auto;padding:10px}.advisor-house-list>button{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;padding:12px;border:1px solid transparent;border-radius:14px;background:transparent;text-align:left;cursor:pointer}.advisor-house-list>button:hover{background:#f6faf8}.advisor-house-list>button.selected{border-color:#0b7655;background:#edf8f2}.advisor-house-list b{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#eaf2ee;color:#0b684c}.advisor-house-list span strong,.advisor-house-list span small{display:block}.advisor-house-list span strong{font-size:12px}.advisor-house-list span small{margin-top:4px;color:#64748b;font-size:10px}.advisor-house-list em{font-style:normal;font-size:9px;font-weight:900;color:#0b7655}.advisor-recommend{width:calc(100% - 20px);margin:0 10px 10px;min-height:48px}
      .advisor-main{display:grid;gap:14px}.advisor-recommendations{overflow:hidden}.advisor-recommendations>header span{color:#64748b;font-size:12px}.advisor-recommendations>div{display:grid;gap:8px;padding:10px}.advisor-recommendations button{display:grid;grid-template-columns:34px minmax(0,1fr) 54px;gap:10px;align-items:center;padding:13px;border:1px solid #e1eae5;border-radius:14px;background:#fff;text-align:left;cursor:pointer}.advisor-recommendations button:hover{border-color:#0b7655;background:#f4faf7}.advisor-recommendations button>b{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#0b7655;color:#fff}.advisor-recommendations button span strong,.advisor-recommendations button span small,.advisor-recommendations button span em{display:block}.advisor-recommendations button span small{margin-top:3px;color:#64748b}.advisor-recommendations button span em{margin-top:4px;color:#4f665a;font-size:10px;font-style:normal}.advisor-recommendations button>i{font-style:normal;font-weight:950;color:#0b7655}
      .advisor-empty-preview{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:28px}.advisor-empty-preview span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.1em}.advisor-empty-preview h3{margin:6px 0;font-size:27px}.advisor-empty-preview p{margin:0;color:#64748b}.advisor-publish-bar{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:16px 18px}.advisor-publish-bar strong,.advisor-publish-bar span{display:block}.advisor-publish-bar span{margin-top:4px;color:#64748b;font-size:11px}
      @media(max-width:1050px){.advisor-controls{grid-template-columns:1fr 1fr}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}@media(max-width:700px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar{align-items:stretch;flex-direction:column}.advisor-controls{grid-template-columns:1fr}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}}
    `}</style>
  </section>;
}
