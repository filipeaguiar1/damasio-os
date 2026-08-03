"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileAdminNav } from "@/components/mobile/MobileAdminNav";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { RouteAdvisorPanel } from "@/components/admin/RouteAdvisorPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import { canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { operationalDateKey } from "@/lib/dates/operationalDate";

type Mode = "view" | "build" | "advisor" | "move";
type MoveMode = "temporary" | "permanent";
type AdvisorHelp = "recommend" | "preview" | "publish" | null;
type RouteEmployee = {
  id: string;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};
type RouteOrigin = { latitude: number; longitude: number; label: string };

const today = () => operationalDateKey();
const selectionId = (home: RouteLead) => home.canonicalVisitId || home.canonicalJobId || home.id;
const jobId = (home: RouteLead) => home.canonicalJobId || home.id;

async function token() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your Admin session expired.");
  return value;
}

async function api(path: string, options?: RequestInit) {
  const access = await token();
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${access}`,
      ...(options?.headers || {}),
    },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Route operation failed.");
  return result;
}

export default function MobileAdminRoutes() {
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<Mode>("view");
  const [moveMode, setMoveMode] = useState<MoveMode>("temporary");
  const [mapView, setMapView] = useState(true);
  const [message, setMessage] = useState("Loading routes...");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [advisorHelp, setAdvisorHelp] = useState<AdvisorHelp>(null);
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null);

  async function refresh(clearMessage = true) {
    try {
      const result = await api("/api/admin/routes");
      const realEmployees: RouteEmployee[] = result.employees || [];
      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard));
      setEmployeeId(current => realEmployees.some(item => item.id === current)
        ? current
        : realEmployees[0]?.id || "");
      setTargetEmployeeId(current => realEmployees.some(item => item.id === current)
        ? current
        : realEmployees[1]?.id || realEmployees[0]?.id || "");
      if (clearMessage) setMessage(realEmployees.length ? "" : "No active Employees found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const employee = employees.find(item => item.id === employeeId) || null;
  const targetEmployee = employees.find(item => item.id === targetEmployeeId) || null;

  useEffect(() => {
    let cancelled = false;
    setRouteOrigin(null);
    const address = employee?.routeStartAddress?.trim();
    if (!address) return () => { cancelled = true; };

    void fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Route start could not be mapped.");
        return response.json() as Promise<{ latitude: number; longitude: number }>;
      })
      .then(point => {
        if (cancelled || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
        setRouteOrigin({
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          label: `${employee?.name || "Employee"} start`,
        });
      })
      .catch(() => {
        if (!cancelled) setRouteOrigin(null);
      });

    return () => { cancelled = true; };
  }, [employee?.id, employee?.name, employee?.routeStartAddress]);

  const route = useMemo(() => {
    if (!employee) return [];
    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
    const datedVisits = leads.filter(item => item.canonicalVisitId
      && item.canonicalRouteId
      && item.scheduledDate === date);
    return canonicalRouteLeadsForEmployee(datedVisits, identity)
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)
        || a.address.localeCompare(b.address));
  }, [leads, employee, date]);

  const jobs = useMemo(() => leads.filter(item => !item.canonicalVisitId), [leads]);
  const availableJobs = useMemo(() => jobs.filter(item => !item.canonicalCrewId), [jobs]);
  const candidates = useMemo(() => availableJobs.filter(home =>
    `${home.name} ${home.address} ${home.service}`.toLowerCase().includes(query.toLowerCase())),
  [availableJobs, query]);
  const movableRoute = useMemo(() => route.filter(item =>
    (item.canonicalVisitStatus || item.status) === "scheduled"), [route]);
  const done = route.filter(item => item.canonicalVisitStatus === "completed" || item.status === "completed").length;

  function switchMode(next: Mode) {
    setMode(next);
    setSelected([]);
    setQuery("");
    setMessage("");
    setAdvisorHelp(null);
    if (next === "view") void refresh(false);
  }

  function toggle(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
  }

  async function assignJobs() {
    if (!employee || !selected.length) {
      setMessage("Select an Employee and at least one available customer.");
      return;
    }
    setBusy(true);
    try {
      const result = await api("/api/admin/routes", {
        method: "POST",
        body: JSON.stringify({ action: "assign", jobIds: selected, crewId: employee.crewId }),
      });
      setSelected([]);
      await refresh(false);
      setMessage(`${result.count} customer${result.count === 1 ? "" : "s"} permanently assigned to ${employee.name}. Route Advisor will choose dated Visits.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customers could not be assigned.");
    } finally {
      setBusy(false);
    }
  }

  async function moveHomes() {
    if (!targetEmployee || !selected.length) {
      setMessage("Select scheduled houses and the destination Employee.");
      return;
    }
    const visits = movableRoute.filter(home => selected.includes(selectionId(home)));
    if (!visits.length) {
      setMessage("Only Scheduled Visits from the selected day can be moved.");
      return;
    }
    const permanent = moveMode === "permanent";
    const confirmed = window.confirm(permanent
      ? `Permanently assign ${visits.length} house${visits.length === 1 ? "" : "s"} to ${targetEmployee.name}? Future Scheduled Visits will also move.`
      : `Temporarily send ${visits.length} house${visits.length === 1 ? "" : "s"} to ${targetEmployee.name} for ${date}? Permanent ownership will not change.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api("/api/admin/route-assignment", {
        method: "POST",
        body: JSON.stringify({
          mode: moveMode,
          visitIds: visits.map(home => home.canonicalVisitId || home.id),
          employeeId: targetEmployee.employeeId,
          crewId: targetEmployee.crewId,
        }),
      });
      setSelected([]);
      setMode("view");
      await refresh(false);
      setMessage(permanent
        ? `${result.jobCount} permanent Job assignment${result.jobCount === 1 ? "" : "s"} moved to ${targetEmployee.name}.`
        : `${result.selectedCount} Visit${result.selectedCount === 1 ? "" : "s"} temporarily sent to ${targetEmployee.name}; future work stays with the regular Employee.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Houses could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  const heroTitle = mode === "build"
    ? "Assign new customers."
    : mode === "move"
      ? "Temporary or permanent move."
      : `${route.length} published stops for ${employee?.name || "Employee"}.`;

  const helpText = advisorHelp === "recommend"
    ? "Recommendation compares distance, workload, capacity, due date and the regular Employee. It never publishes automatically."
    : advisorHelp === "preview"
      ? "Preview lets the Admin change Employee, date and house order before saving."
      : advisorHelp === "publish"
        ? "Publish creates or moves dated Visits only. Permanent Job ownership remains controlled by Build and Permanent Move."
        : "";

  return <MobileRoleGuard allowed={["admin", "manager"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-native-subpage mobile-route-builder">
      <header className="role-mobile-topbar">
        <MobileBackButton fallback="/mobile/admin" />
        <div><strong>Routes</strong><span>Canonical Employee routes</span></div>
        <button className="mobile-native-add mobile-native-check" onClick={() => void refresh()} aria-label="Refresh">↻</button>
      </header>

      {mode !== "advisor" && <section className="mobile-native-hero routes">
        <span>LIVE DATABASE</span>
        <h1>{heroTitle}</h1>
        <p>{mode === "view"
          ? `${done} completed · ${route.length - done} remaining`
          : mode === "build"
            ? "Customer Job → permanent Employee"
            : "Scheduled Visit → chosen Employee"}</p>
      </section>}

      <nav className="mobile-route-modes mobile-route-modes-four">
        <button className={mode === "view" ? "active" : ""} onClick={() => switchMode("view")}>View</button>
        <button className={mode === "build" ? "active" : ""} onClick={() => switchMode("build")}>＋ Build</button>
        <button className={mode === "advisor" ? "active" : ""} onClick={() => switchMode("advisor")}>Advisor</button>
        <button className={mode === "move" ? "active" : ""} onClick={() => switchMode("move")}>⇄ Move</button>
      </nav>

      {(mode === "view" || mode === "move") && <section className="mobile-route-pickers">
        <label><span>{mode === "move" ? "From Employee" : "Employee"}</span><div><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}>{employees.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><b>⌄</b></div></label>
        <label><span>Day</span><div><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /><b>⌄</b></div></label>
      </section>}

      {mode === "build" && <section className="mobile-route-pickers mobile-build-employee">
        <label><span>Permanent Employee</span><div><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}>{employees.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><b>⌄</b></div></label>
      </section>}

      {message && mode !== "advisor" && <div className="mobile-native-message" role="status" aria-live="polite">{message}</div>}

      {mode === "view" && <>
        <div className="mobile-native-toggle"><button className={mapView ? "active" : ""} onClick={() => setMapView(true)}>Map</button><button className={!mapView ? "active" : ""} onClick={() => setMapView(false)}>List <b>{route.length}</b></button></div>
        {mapView
          ? <EmployeeRouteMap
              route={route}
              routeId={route[0]?.canonicalRouteId}
              originPoint={routeOrigin}
              actionLabel="Show in list"
              onOpenVisit={() => setMapView(false)}
            />
          : <RouteList homes={route} selected={[]} onToggle={() => {}} selectable={false} />}
      </>}

      {mode === "build" && <>
        <div className="mobile-native-search"><i>⌕</i><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search new customer or address" /></div>
        <div className="mobile-selection-head"><span>{selected.length} selected</span><button onClick={() => setSelected(selected.length ? [] : candidates.map(jobId))}>{selected.length ? "Clear" : "Select all"}</button></div>
        <RouteList homes={candidates} selected={selected} onToggle={toggle} selectable />
        <section className="mobile-build-assignment">
          <div><small>PERMANENT ASSIGNMENT</small><strong>{employee?.name || "Choose Employee"}</strong><span>No date is created here. Advisor publishes the daily Visit later.</span></div>
          <button disabled={busy || !employee || !selected.length} onClick={() => void assignJobs()}>{busy ? "Assigning…" : `Assign ${selected.length} customer${selected.length === 1 ? "" : "s"}`}</button>
        </section>
      </>}

      {mode === "advisor" && <section className="mobile-route-advisor">
        <header className="mobile-advisor-header"><div><small>ROUTE ADVISOR</small><strong>Plan and review</strong></div><button type="button" onClick={() => setAdvisorHelp(advisorHelp ? null : "recommend")} aria-label="About Route Advisor">!</button></header>
        <div className="mobile-advisor-help-tools">
          <button type="button" onClick={() => setAdvisorHelp(advisorHelp === "recommend" ? null : "recommend")}>Recommend <i>!</i></button>
          <button type="button" onClick={() => setAdvisorHelp(advisorHelp === "preview" ? null : "preview")}>Preview <i>!</i></button>
          <button type="button" onClick={() => setAdvisorHelp(advisorHelp === "publish" ? null : "publish")}>Publish <i>!</i></button>
        </div>
        {advisorHelp && <div className="mobile-advisor-info">{helpText}</div>}
        <RouteAdvisorPanel />
      </section>}

      {mode === "move" && <>
        <p className="mobile-route-help">Select Scheduled Visits from {employee?.name} on {date}. Active and completed houses stay locked.</p>
        <RouteList homes={movableRoute} selected={selected} onToggle={toggle} selectable />
        <section className="mobile-move-panel">
          <label><span>Move to Employee</span><div><select value={targetEmployeeId} onChange={event => setTargetEmployeeId(event.target.value)}>{employees.filter(item => item.id !== employeeId).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><b>⌄</b></div></label>
          <div className="mobile-move-mode" role="group" aria-label="Move type">
            <button type="button" className={moveMode === "temporary" ? "active" : ""} onClick={() => setMoveMode("temporary")}><strong>Temporary</strong><small>Only this dated Visit</small></button>
            <button type="button" className={moveMode === "permanent" ? "active" : ""} onClick={() => setMoveMode("permanent")}><strong>Permanent</strong><small>Job and future Visits</small></button>
          </div>
          <div className="mobile-move-explanation">{moveMode === "temporary"
            ? "The other Employee performs this service. The house remains permanently assigned to its regular Employee for future work."
            : "The permanent Job owner changes, and future Scheduled Visits move too. Completed history never changes."}</div>
          <button disabled={busy || !targetEmployee || !selected.length} onClick={() => void moveHomes()}>{busy ? "Moving…" : `${moveMode === "temporary" ? "Move temporarily" : "Move permanently"} (${selected.length})`}</button>
        </section>
      </>}

      <style jsx global>{`
        .mobile-route-modes-four{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .mobile-route-modes-four button{min-width:0;padding-left:6px!important;padding-right:6px!important}
        .mobile-build-employee{grid-template-columns:1fr!important}
        .mobile-build-assignment{display:grid;gap:12px;margin:14px 0 18px;padding:16px;border:1px solid #d8e7df;border-radius:20px;background:#fff}.mobile-build-assignment div{display:grid;gap:4px}.mobile-build-assignment small{color:#0b7046;font-size:9px;font-weight:950;letter-spacing:.1em}.mobile-build-assignment strong{font-size:20px}.mobile-build-assignment span{color:#66776f;font-size:12px;line-height:1.45}.mobile-build-assignment>button,.mobile-move-panel>button{min-height:52px;border:0;border-radius:15px;background:#0b7046;color:#fff;font-weight:950}.mobile-build-assignment>button:disabled,.mobile-move-panel>button:disabled{opacity:.5}
        .mobile-route-advisor{display:grid;min-width:0;gap:10px;margin-top:12px;padding-bottom:20px}.mobile-advisor-header{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border:1px solid #dbe7e1;border-radius:18px;background:#fff}.mobile-advisor-header small,.mobile-advisor-header strong{display:block}.mobile-advisor-header small{color:#0b7046;font-size:9px;font-weight:950;letter-spacing:.12em}.mobile-advisor-header strong{margin-top:2px;font-size:18px}.mobile-advisor-header>button,.mobile-advisor-help-tools i{display:grid;place-items:center;border:0;border-radius:999px;background:#e6f3eb;color:#0b7046;font-style:normal;font-weight:950}.mobile-advisor-header>button{width:32px;height:32px}.mobile-advisor-help-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.mobile-advisor-help-tools button{display:flex;align-items:center;justify-content:center;gap:6px;min-height:38px;border:1px solid #dbe7e1;border-radius:12px;background:#fff;color:#274a3a;font-size:11px;font-weight:900}.mobile-advisor-help-tools i{width:18px;height:18px;font-size:10px}.mobile-advisor-info{padding:12px 14px;border-radius:14px;background:#edf8f1;color:#315445;font-size:12px;line-height:1.45}.mobile-route-advisor .advisor-shell{min-width:0;gap:10px}.mobile-route-advisor .advisor-hero{display:none!important}.mobile-route-advisor .advisor-controls{grid-template-columns:1fr!important;gap:9px;padding:12px;border-radius:17px}.mobile-route-advisor .advisor-layout{grid-template-columns:1fr!important;gap:10px}.mobile-route-advisor .advisor-house-picker{position:static!important;border-radius:17px}.mobile-route-advisor .advisor-house-list{max-height:390px}.mobile-route-advisor .advisor-house-list>button{grid-template-columns:30px minmax(0,1fr);padding:10px}.mobile-route-advisor .advisor-house-list>button>em{grid-column:2;text-align:left}.mobile-route-advisor .advisor-main>section{border-radius:17px}.mobile-route-advisor .advisor-empty-preview{padding:16px}.mobile-route-advisor .advisor-empty-preview h3{font-size:20px}.mobile-route-advisor .advisor-empty-preview p{font-size:11px}.mobile-route-advisor .advisor-recommendations button{grid-template-columns:30px minmax(0,1fr) 44px}.mobile-route-advisor .advisor-impact{grid-template-columns:repeat(2,1fr)!important}.mobile-route-advisor .advisor-manual-order h3{font-size:16px}.mobile-route-advisor .advisor-publish-bar{padding:14px}
        .mobile-move-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mobile-move-mode button{display:grid;gap:3px;padding:12px;border:1px solid #d5e3dc;border-radius:14px;background:#fff;color:#355646;text-align:left}.mobile-move-mode button.active{border-color:#0b7046;background:#edf8f1;color:#0b7046}.mobile-move-mode strong{font-size:13px}.mobile-move-mode small{font-size:9px}.mobile-move-explanation{padding:12px;border-radius:13px;background:#f2f7f4;color:#5d7066;font-size:11px;line-height:1.45}
      `}</style>

      <MobileAdminNav active="routes" />
    </main>
  </MobileRoleGuard>;
}

function RouteList({ homes, selected, onToggle, selectable }: {
  homes: RouteLead[];
  selected: string[];
  onToggle: (id: string) => void;
  selectable: boolean;
}) {
  return <section className="mobile-native-route-list selectable">
    {homes.map((home, index) => {
      const id = selectionId(home);
      const complete = home.canonicalVisitStatus === "completed" || home.status === "completed";
      return <button className={selected.includes(id) ? "selected" : ""} onClick={() => selectable && onToggle(id)} type="button" key={id}>
        <b>{selectable ? (selected.includes(id) ? "✓" : "") : home.routeOrder || index + 1}</b>
        <div><strong>{home.name}</strong><span>{home.address}</span><small>{home.service} · {home.assignedCrew || "Unassigned"}</small></div>
        <i className={complete ? "done" : ""}>{complete ? "Done" : home.canonicalRouteId ? home.assignedCrew || "Scheduled" : "Available"}</i>
      </button>;
    })}
    {!homes.length && <div className="mobile-native-empty"><i>⌖</i><strong>No houses found</strong><p>Only canonical Jobs and dated Visits appear here.</p></div>}
  </section>;
}
