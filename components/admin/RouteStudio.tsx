"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OfficialRoutePlanMap } from "@/components/admin/OfficialRoutePlanMap";
import { RouteAdvisorPanel } from "@/components/admin/RouteAdvisorPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { belongsToCanonicalEmployee, canonicalRouteWarnings } from "@/lib/routes/canonicalRouteIdentity";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};

type Mode = "view" | "build" | "advisor" | "move";
type MoveMode = "temporary" | "permanent";

function jobId(home: RouteLead) {
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

export function RouteStudio() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("view");
  const [moveMode, setMoveMode] = useState<MoveMode>("temporary");
  const [date, setDate] = useState(operationalDateKey());
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading routes...");
  const [busy, setBusy] = useState(false);

  async function refresh(silent = false) {
    try {
      const token = await accessToken();
      const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Routes could not be loaded.");
      const realEmployees: RouteEmployee[] = result.employees || [];
      const mapped = schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard);
      const warnings = canonicalRouteWarnings(mapped);
      setEmployees(realEmployees);
      setLeads(mapped);
      setEmployeeId(current => realEmployees.some(item => item.id === current)
        ? current
        : realEmployees[0]?.id || "");
      setTargetEmployeeId(current => realEmployees.some(item => item.id === current)
        ? current
        : realEmployees.find(item => item.id !== realEmployees[0]?.id)?.id || realEmployees[0]?.id || "");
      if (!silent) {
        if (!realEmployees.length) setMessage("No active Employees found. Add an Employee before assigning customers.");
        else if (warnings.length) setMessage(`${warnings.length} published route stop${warnings.length === 1 ? "" : "s"} need canonical ID repair.`);
        else setMessage("");
      }
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (["view", "build", "advisor", "move"].includes(requested || "")) {
      setMode(requested as Mode);
    }
  }, [searchParams]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [date]);

  const jobs = useMemo(() => leads.filter(item => !item.canonicalVisitId), [leads]);
  const visits = useMemo(() => leads.filter(item => Boolean(item.canonicalVisitId)), [leads]);
  const available = useMemo(() => jobs.filter(item => !item.canonicalCrewId), [jobs]);
  const sourceEmployee = employees.find(item => item.id === employeeId) || null;
  const targetEmployee = employees.find(item => item.id === targetEmployeeId) || null;
  const sourceIdentity = sourceEmployee
    ? { id: sourceEmployee.employeeId || sourceEmployee.id, crewId: sourceEmployee.crewId }
    : null;
  const normalized = query.trim().toLowerCase();
  const visibleAvailable = useMemo(() => available.filter(item =>
    !normalized || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized)),
  [available, normalized]);
  const sourceRoute = useMemo(() => sourceIdentity ? visits.filter(item =>
    item.scheduledDate === date && belongsToCanonicalEmployee(item, sourceIdentity))
    .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)) : [],
  [visits, date, sourceIdentity?.id, sourceIdentity?.crewId]);
  const movableSource = useMemo(() => sourceRoute.filter(item =>
    (item.canonicalVisitStatus || item.status) === "scheduled"), [sourceRoute]);

  function changeMode(next: Mode) {
    setMode(next);
    setSelected([]);
    setQuery("");
    setMessage("");
    window.history.replaceState(null, "", `/admin/routes?tab=${next}`);
  }

  function toggle(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
  }

  function selectVisible(items: RouteLead[]) {
    const ids = items.map(jobId);
    setSelected(current => ids.every(id => current.includes(id))
      ? current.filter(id => !ids.includes(id))
      : [...new Set([...current, ...ids])]);
  }

  async function post(path: string, body: Record<string, unknown>) {
    const token = await accessToken();
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The route change could not be saved.");
    return result;
  }

  async function assignSelected() {
    if (!sourceEmployee || !selected.length) return;
    setBusy(true);
    try {
      const result = await post("/api/admin/routes", {
        action: "assign",
        jobIds: selected,
        crewId: sourceEmployee.crewId,
      });
      setMessage(`${result.count} customer${result.count === 1 ? "" : "s"} permanently assigned to ${sourceEmployee.name}. Use Route Advisor to choose the day and driving order.`);
      setSelected([]);
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function moveSelected() {
    if (!sourceEmployee || !targetEmployee || !selected.length) return;
    const selectedSet = new Set(selected);
    const selectedStops = movableSource.filter(item => selectedSet.has(jobId(item)));
    if (!selectedStops.length) {
      setMessage("Only Scheduled Visits can be moved.");
      return;
    }

    const permanent = moveMode === "permanent";
    const confirmed = window.confirm(permanent
      ? `Permanently assign ${selectedStops.length} house${selectedStops.length === 1 ? "" : "s"} to ${targetEmployee.name}? Future Scheduled Visits will also move.`
      : `Temporarily send ${selectedStops.length} house${selectedStops.length === 1 ? "" : "s"} to ${targetEmployee.name} for ${date}? Permanent ownership will stay unchanged.`);
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await post("/api/admin/route-assignment", {
        mode: moveMode,
        visitIds: selectedStops.map(item => item.canonicalVisitId || item.id),
        employeeId: targetEmployee.employeeId || targetEmployee.id,
        crewId: targetEmployee.crewId,
      });
      setMessage(permanent
        ? `${result.jobCount} permanent Job assignment${result.jobCount === 1 ? "" : "s"} moved to ${targetEmployee.name}; future Scheduled Visits followed automatically.`
        : `${result.selectedCount} dated Visit${result.selectedCount === 1 ? "" : "s"} temporarily moved to ${targetEmployee.name}; the regular Employee remains unchanged.`);
      setSelected([]);
      await refresh(true);
      changeMode("view");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Move failed.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "build"
    ? "Assign each new Customer Job to its regular Employee."
    : mode === "advisor"
      ? "Choose the strongest daily route — then review it manually."
      : mode === "move"
        ? "Move a dated Visit temporarily or change Job ownership permanently."
        : `${employees.length} active Employee${employees.length === 1 ? "" : "s"} on the official Route Plan.`;

  return <section className="desktop-route-studio">
    <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{title}</h1><p>One source of truth: Customer, Property, Job, dated Visit, published Route and canonical Employee.</p></div><button className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Working..." : "Refresh"}</button></header>

    <nav className="desktop-route-modes">
      <button className={mode === "view" ? "active" : ""} onClick={() => changeMode("view")}>View</button>
      <button className={mode === "build" ? "active" : ""} onClick={() => changeMode("build")}>Build</button>
      <button className={mode === "advisor" ? "active" : ""} onClick={() => changeMode("advisor")}>Route Advisor</button>
      <button className={mode === "move" ? "active" : ""} onClick={() => changeMode("move")}>Move</button>
    </nav>

    {message && <div className="desktop-route-message">{message}</div>}

    {mode === "view" && <OfficialRoutePlanMap date={date} onDateChange={setDate} />}
    {mode === "advisor" && <RouteAdvisorPanel />}

    {mode === "build" && <section className="route-simple-workspace">
      <header className="route-simple-controls"><label><span>Permanent Employee</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Search available Customer Jobs</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Customer, address or service" /></label></header>
      <div className="route-simple-grid"><aside><div className="route-simple-head"><strong>{selected.length} selected</strong><span>{visibleAvailable.length} available</span></div><button className="btn btn-outline route-simple-all" onClick={() => selectVisible(visibleAvailable)}>Select visible</button><RouteChoiceList items={visibleAvailable} selected={selected} onToggle={toggle} /></aside><section className="route-simple-summary"><span>PERMANENT ASSIGNMENT</span><h2>{sourceEmployee?.name || "Choose an Employee"}</h2><p>Build assigns the canonical Job to its regular Employee. It does not create a date or publish a route.</p><p>The Customer is still created through Customer → Property → Quote → Job. Build only establishes operational ownership.</p><button className="btn btn-primary" disabled={busy || !sourceEmployee || !selected.length} onClick={() => void assignSelected()}>{busy ? "Assigning..." : `Assign ${selected.length} Jobs`}</button></section></div>
    </section>}

    {mode === "move" && <section className="route-simple-workspace">
      <header className="route-move-controls"><label><span>From Employee</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Visit date</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /></label><label><span>To Employee</span><select value={targetEmployeeId} onChange={event => setTargetEmployeeId(event.target.value)}><option value="">Select Employee</option>{employees.filter(item => item.id !== employeeId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></header>
      <div className="route-simple-grid"><aside><div className="route-simple-head"><strong>{selected.length} selected</strong><span>{movableSource.length} scheduled</span></div><RouteChoiceList items={movableSource} selected={selected} onToggle={toggle} />{sourceRoute.some(item => ["completed", "in_progress"].includes(item.canonicalVisitStatus || "")) && <p className="route-lock-note">Completed and active houses stay locked on the original executor and route.</p>}</aside><section className="route-simple-summary route-move-summary"><span>ASSIGNMENT MODE</span><h2>{targetEmployee?.name || "Choose destination"}</h2><div className="route-move-mode"><button type="button" className={moveMode === "temporary" ? "active" : ""} onClick={() => setMoveMode("temporary")}><strong>Temporary</strong><small>Only the selected dated Visit</small></button><button type="button" className={moveMode === "permanent" ? "active" : ""} onClick={() => setMoveMode("permanent")}><strong>Permanent</strong><small>Job ownership and future Scheduled Visits</small></button></div><p>{moveMode === "temporary" ? "The destination Employee performs this service. Future work remains with the regular Employee because the permanent Job assignment is untouched." : "The canonical Job owner changes. Every future Scheduled Visit moves, while completed history continues to show who actually worked."}</p><button className="btn btn-primary" disabled={busy || !targetEmployee || !selected.length} onClick={() => void moveSelected()}>{busy ? "Moving..." : `${moveMode === "temporary" ? "Move temporarily" : "Move permanently"} (${selected.length})`}</button></section></div>
    </section>}

    <style jsx global>{`
      .route-simple-workspace{display:grid;gap:14px;margin-top:18px}.route-simple-controls,.route-move-controls{display:grid;grid-template-columns:280px 1fr;gap:12px;padding:16px;border:1px solid #dbe7e1;border-radius:20px;background:#fff}.route-move-controls{grid-template-columns:repeat(3,minmax(190px,1fr))}.route-simple-controls label,.route-move-controls label{display:grid;gap:6px}.route-simple-controls span,.route-move-controls span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.route-simple-controls input,.route-simple-controls select,.route-move-controls input,.route-move-controls select{min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff}.route-simple-grid{display:grid;grid-template-columns:minmax(340px,1fr) minmax(300px,.7fr);gap:14px}.route-simple-grid>aside,.route-simple-summary{overflow:hidden;border:1px solid #dbe7e1;border-radius:22px;background:#fff}.route-simple-head{display:flex;justify-content:space-between;padding:15px 16px;border-bottom:1px solid #e7eeea}.route-simple-head span{color:#64748b}.route-simple-all{margin:12px;width:calc(100% - 24px)}.route-choice-list{display:grid;gap:7px;max-height:640px;overflow:auto;padding:10px}.route-choice-list button{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;padding:12px;border:1px solid transparent;border-radius:14px;background:transparent;text-align:left;cursor:pointer}.route-choice-list button:hover{background:#f5faf7}.route-choice-list button.selected{border-color:#0b7655;background:#edf8f2}.route-choice-list b{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#eaf2ee;color:#0b684c}.route-choice-list strong,.route-choice-list small{display:block}.route-choice-list small{margin-top:4px;color:#64748b}.route-choice-list em{font-style:normal;color:#0b7655;font-size:10px;font-weight:900}.route-simple-summary{align-content:start;display:grid;gap:12px;padding:26px;background:linear-gradient(145deg,#0a382a,#0d6545);color:#fff}.route-simple-summary>span{color:#9ce3b9;font-size:10px;font-weight:950;letter-spacing:.12em}.route-simple-summary h2{margin:0;font-size:32px}.route-simple-summary p{margin:0;color:rgba(255,255,255,.7);line-height:1.6}.route-simple-summary .btn{margin-top:10px;background:#fff;color:#0b5f42}.route-move-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px}.route-move-mode button{display:grid;gap:4px;padding:14px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.08);color:#fff;text-align:left;cursor:pointer}.route-move-mode button.active{border-color:#9ce3b9;background:rgba(156,227,185,.18)}.route-move-mode strong,.route-move-mode small{display:block}.route-move-mode small{color:rgba(255,255,255,.65)}.route-lock-note{margin:10px;padding:12px;border-radius:12px;background:#ecf8f0;color:#27704d;font-size:12px}.route-empty{padding:28px;text-align:center;color:#64748b}@media(max-width:1000px){.route-simple-controls,.route-move-controls,.route-simple-grid{grid-template-columns:1fr}}
    `}</style>
  </section>;
}

function RouteChoiceList({ items, selected, onToggle }: {
  items: RouteLead[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return <div className="route-choice-list">{items.map((home, index) => {
    const id = jobId(home);
    const active = selected.includes(id);
    return <button type="button" key={id} className={active ? "selected" : ""} onClick={() => onToggle(id)}><b>{home.routeOrder || index + 1}</b><span><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service}{home.nextVisitDate ? ` · ${home.nextVisitDate}` : ""}</small></span><em>{active ? "Selected" : home.canonicalVisitStatus === "missed" ? "Needs reschedule" : "Choose"}</em></button>;
  })}{!items.length && <div className="route-empty">No matching houses.</div>}</div>;
}
