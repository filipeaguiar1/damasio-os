"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { CustomerPropertyModal } from "@/components/property/CustomerPropertyModal";
import { OfficialRoutePlanMap } from "@/components/admin/OfficialRoutePlanMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import {
  belongsToCanonicalEmployee,
  canonicalRouteWarnings,
} from "@/lib/routes/canonicalRouteIdentity";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};
type Mode = "view" | "build" | "smart" | "move";
type StartMode = "employee" | "manual";
type Origin = { latitude: number; longitude: number; label: string };

const todayKey = () => new Date().toISOString().slice(0, 10);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

export function RouteStudio() {
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [targetDate, setTargetDate] = useState(todayKey());
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [message, setMessage] = useState("Loading routes...");
  const [busy, setBusy] = useState(false);
  const [propertyPreview, setPropertyPreview] = useState<RouteLead | null>(null);
  const [startMode, setStartMode] = useState<StartMode>("employee");
  const [manualStartAddress, setManualStartAddress] = useState("");
  const [smartPreview, setSmartPreview] = useState<RouteLead[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [viewOrigin, setViewOrigin] = useState<Origin | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  async function refresh(silent = false) {
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/routes", {
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
      setEmployeeId(current => realEmployees.some(item => item.id === current) ? current : "");
      setTargetEmployeeId(current => realEmployees.some(item => item.id === current)
        ? current
        : realEmployees[1]?.id || realEmployees[0]?.id || "");

      console.info("admin-route-canonical-health", {
        employeeCount: realEmployees.length,
        visitCount: mapped.filter(item => item.canonicalVisitId).length,
        warningCount: warnings.length,
        warningVisitIds: warnings.map(item => item.visitId),
      });

      if (!silent) {
        if (!realEmployees.length) setMessage("No Employees have been added yet. Add an Employee before assigning customers.");
        else if (warnings.length) setMessage(`${warnings.length} route stop${warnings.length === 1 ? "" : "s"} need canonical ID repair.`);
        else setMessage("");
      }
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (["view", "build", "smart", "move"].includes(requested || "")) setMode(requested as Mode);
  }, [searchParams]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const employee = employees.find(item => item.id === employeeId) || null;
  const targetEmployee = employees.find(item => item.id === targetEmployeeId) || null;
  const employeeIdentity = employee
    ? { id: employee.employeeId || employee.id, crewId: employee.crewId }
    : null;

  const jobs = useMemo(() => leads.filter(item => !item.canonicalVisitId), [leads]);
  const visits = useMemo(() => leads.filter(item => Boolean(item.canonicalVisitId)), [leads]);
  const available = useMemo(() => jobs.filter(item => !item.canonicalCrewId), [jobs]);
  const assigned = useMemo(() => jobs.filter(item => Boolean(item.canonicalCrewId)), [jobs]);

  const employeeCustomers = useMemo(() => {
    if (!employeeIdentity) return [];
    return assigned
      .filter(item => belongsToCanonicalEmployee(item, employeeIdentity))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
  }, [assigned, employeeIdentity?.id, employeeIdentity?.crewId]);

  const employeeDayRoute = useMemo(() => {
    if (!employeeIdentity) return [];
    return visits
      .filter(item => item.scheduledDate === date && belongsToCanonicalEmployee(item, employeeIdentity))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
  }, [visits, employeeIdentity?.id, employeeIdentity?.crewId, date]);

  const employeeRouteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const worker of employees) {
      const identity = { id: worker.employeeId || worker.id, crewId: worker.crewId };
      counts.set(worker.id, visits.filter(item => item.scheduledDate === date && belongsToCanonicalEmployee(item, identity)).length);
    }
    return counts;
  }, [employees, visits, date]);

  const normalized = query.trim().toLowerCase();
  const filter = (items: RouteLead[]) => items.filter(item =>
    !normalized || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized));
  const buildAvailable = useMemo(() => filter(available).sort((a, b) => a.address.localeCompare(b.address)), [available, normalized]);
  const smartCandidates = useMemo(() => filter(employeeCustomers), [employeeCustomers, normalized]);
  const moveCandidates = useMemo(() => filter(employeeCustomers.filter(item => !item.scheduledDate || item.scheduledDate === date)), [employeeCustomers, date, normalized]);
  const visibleEmployeeRoute = useMemo(() => filter(employeeDayRoute), [employeeDayRoute, normalized]);
  const selectedJobs = jobs.filter(item => selected.includes(item.id));
  const buildMapHomes = useMemo(() => [
    ...employeeCustomers.map(item => ({ ...item, status: "completed" as const })),
    ...available,
  ], [employeeCustomers, available]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "view" || !employee?.routeStartAddress) {
      setViewOrigin(null);
      return () => { cancelled = true; };
    }
    geocode(employee.routeStartAddress)
      .then(point => {
        if (!cancelled) setViewOrigin({ ...point, label: `${employee.name} start` });
      })
      .catch(() => {
        if (!cancelled) setViewOrigin(null);
      });
    return () => { cancelled = true; };
  }, [mode, employee?.id, employee?.routeStartAddress]);

  function changeMode(next: Mode) {
    setMode(next);
    setSelected([]);
    setQuery("");
    setPropertyPreview(null);
    setSmartPreview([]);
    setOrigin(null);
    setViewOrigin(null);
    if (next === "view") setEmployeeId("");
    else if (!employeeId) setEmployeeId(employees[0]?.id || "");
    window.history.replaceState(null, "", `/admin/routes?tab=${next}`);
  }

  function openEmployee(worker: RouteEmployee) {
    setEmployeeId(worker.id);
    setQuery("");
    setPropertyPreview(null);
  }

  function toggle(id: string) {
    setSmartPreview([]);
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  function selectVisible(items: RouteLead[]) {
    setSmartPreview([]);
    const ids = items.map(item => item.id);
    setSelected(current => ids.every(id => current.includes(id))
      ? current.filter(id => !ids.includes(id))
      : [...new Set([...current, ...ids])]);
  }

  async function post(body: Record<string, unknown>) {
    const token = await accessToken();
    const response = await fetch("/api/admin/routes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The route change could not be saved.");
    return result;
  }

  async function assignSelected() {
    if (!employee || !selectedJobs.length) return;
    const ids = new Set(selectedJobs.map(item => item.id));
    setLeads(current => current.map(item => ids.has(item.id) ? {
      ...item,
      assignedCrew: employee.name,
      canonicalCrewId: employee.crewId,
    } : item));
    setSelected([]);
    setBusy(true);
    try {
      const result = await post({
        action: "assign",
        jobIds: selectedJobs.map(item => item.canonicalJobId || item.id),
        crewId: employee.crewId,
      });
      setMessage(`${result.count} customer${result.count === 1 ? "" : "s"} assigned to ${employee.name}.`);
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignment failed.");
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }

  async function returnToAvailable(home: RouteLead) {
    if (!window.confirm(`Return ${home.name} to available customers?`)) return;
    setPropertyPreview(null);
    setLeads(current => current.map(item => item.id === home.id ? {
      ...item,
      assignedCrew: undefined,
      canonicalCrewId: undefined,
      scheduledDate: undefined,
      routeOrder: undefined,
    } : item));
    setBusy(true);
    try {
      await post({ action: "unassign", jobIds: [home.canonicalJobId || home.id] });
      setMessage(`${home.name} returned to available customers.`);
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be returned.");
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }

  async function geocode(address: string) {
    const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Address could not be mapped: ${address}`);
    return await response.json() as { latitude: number; longitude: number };
  }

  async function generatePreview() {
    if (!employee || !selectedJobs.length) {
      setMessage("Select an Employee and at least one assigned customer.");
      return;
    }
    const startAddress = startMode === "employee" ? employee.routeStartAddress : manualStartAddress.trim();
    if (!startAddress) {
      setMessage("Choose a valid starting address.");
      return;
    }
    setPreviewBusy(true);
    setMessage("Mapping properties and optimizing the driving order...");
    try {
      const start = await geocode(startAddress);
      const mapped = await Promise.all(selectedJobs.map(async home =>
        Number.isFinite(home.latitude) && Number.isFinite(home.longitude)
          ? home
          : { ...home, ...await geocode(home.address) }));
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
      setOrigin({
        latitude: start.latitude,
        longitude: start.longitude,
        label: startMode === "employee" ? `${employee.name} start` : "Manual route start",
      });
      setSmartPreview(ordered);
      setMessage("Preview ready. Review the numbered route and confirm publication.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Smart Route preview failed.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function publishSmart() {
    if (!employee || !smartPreview.length) return;
    setBusy(true);
    try {
      const result = await post({
        action: "smart",
        jobIds: smartPreview.map(item => item.canonicalJobId || item.id),
        employeeId: employee.employeeId || employee.id,
        crewId: employee.crewId,
        routeDate: date,
      });
      setMessage(`Smart Route published for ${employee.name} with ${result.count} stops.`);
      setSelected([]);
      setSmartPreview([]);
      await refresh(true);
      changeMode("view");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Smart Route could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function moveSelected() {
    if (!targetEmployee || !selectedJobs.length) return;
    setBusy(true);
    try {
      const result = await post({
        action: "move",
        jobIds: selectedJobs.map(item => item.canonicalJobId || item.id),
        employeeId: targetEmployee.employeeId || targetEmployee.id,
        crewId: targetEmployee.crewId,
        routeDate: targetDate,
      });
      setMessage(`${result.count} houses moved to ${targetEmployee.name}.`);
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
    ? "Assign customers to an Employee."
    : mode === "smart"
      ? "Build the daily Smart Route."
      : mode === "move"
        ? "Move houses between Employees."
        : employee
          ? `${employeeDayRoute.length} stops for ${employee.name}.`
          : `${employees.length} available Employee${employees.length === 1 ? "" : "s"}.`;

  return <section className="desktop-route-studio">
    <header className="desktop-route-hero">
      <div>
        <span>Dispatch & Routes</span>
        <h1>{title}</h1>
        <p>One synchronized workspace using Customer, Property, Job, Visit, Route and Employee IDs.</p>
      </div>
      <div className="desktop-route-actions">
        {mode === "view" && employee && <button className="btn btn-outline" onClick={() => setEmployeeId("")}>Back to Employees</button>}
        <button className="btn btn-outline" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        {employee && <Link className="btn btn-primary" href={`/employee/route?employeeId=${encodeURIComponent(employee.employeeId || employee.id)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}
      </div>
    </header>

    <nav className="desktop-route-modes">
      <button className={mode === "view" ? "active" : ""} onClick={() => changeMode("view")}>View</button>
      <button className={mode === "build" ? "active" : ""} onClick={() => changeMode("build")}>Build</button>
      <button className={mode === "smart" ? "active" : ""} onClick={() => changeMode("smart")}>Smart Route</button>
      <button className={mode === "move" ? "active" : ""} onClick={() => changeMode("move")}>Move</button>
    </nav>

    {mode === "view" && <section className="desktop-route-controls route-controls-view">
      <label><span>Day</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      {employee && <label className="route-search"><span>Search houses</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, address, city or service" /></label>}
    </section>}

    {mode !== "view" && mode !== "move" && <section className="desktop-route-controls route-controls-dynamic">
      <label>
        <span>Employee</span>
        <select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); setSmartPreview([]); }}>
          <option value="">Select an Employee</option>
          {employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {mode !== "build" && <label><span>Day</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSmartPreview([]); }} /></label>}
      <label className="route-search"><span>Search customers</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, address, city or service" /></label>
    </section>}

    {message && <div className="desktop-route-message">{message}</div>}

    {mode === "view" && !employee && <OfficialRoutePlanMap />}

    {mode === "view" && employee && <section className="desktop-route-workspace">
      <MapCard title={`${employee.name} route`} count={visibleEmployeeRoute.length}>
        <EmployeeRouteMap
          route={visibleEmployeeRoute}
          originPoint={viewOrigin}
          desktop
          actionLabel="Property profile"
          onOpenVisit={setPropertyPreview}
        />
        <div className="route-map-legend">
          <span><i className="origin" />Route start</span>
          <span><i className="blue" />Driving order</span>
        </div>
      </MapCard>
      <RouteList items={visibleEmployeeRoute} onClick={setPropertyPreview} empty="No stops for this date." />
    </section>}

    {mode === "build" && <section className="desktop-route-workspace">
      <MapCard title="Assigned and available properties" count={buildMapHomes.length}>
        <EmployeeRouteMap route={buildMapHomes} desktop actionLabel="Property profile" onOpenVisit={home => home.canonicalCrewId ? setPropertyPreview(home) : toggle(home.id)} />
        <div className="route-map-legend"><span><i className="green" />Assigned</span><span><i className="blue" />Available</span></div>
      </MapCard>
      <aside className="desktop-route-side">
        <div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{buildAvailable.length} available</span></div>
        <button className="btn btn-outline route-select-all" onClick={() => selectVisible(buildAvailable)}>Select visible</button>
        <RouteButtons items={buildAvailable} selected={selected} onClick={home => toggle(home.id)} label="Available" />
        <div className="desktop-route-build-box">
          <small>Assign customers only. The daily order is created in Smart Route.</small>
          <button className="btn btn-primary" disabled={busy || !selected.length || !employee} onClick={() => void assignSelected()}>{busy ? "Assigning..." : `Assign ${selected.length} customers`}</button>
        </div>
      </aside>
    </section>}

    {mode === "smart" && <>
      <section className="smart-route-start-card">
        <div><span>Route start</span><strong>Choose the route origin</strong></div>
        <label className={startMode === "employee" ? "selected" : ""}>
          <input type="radio" checked={startMode === "employee"} onChange={() => { setStartMode("employee"); setSmartPreview([]); }} />
          <span><b>Employee default address</b><small>{employee?.routeStartAddress || "No default address saved"}</small></span>
        </label>
        <label className={startMode === "manual" ? "selected" : ""}>
          <input type="radio" checked={startMode === "manual"} onChange={() => { setStartMode("manual"); setSmartPreview([]); }} />
          <span><b>Manual starting address</b><small>Use another origin for this route</small></span>
        </label>
        {startMode === "manual" && <AddressAutocomplete value={manualStartAddress} onChange={value => { setManualStartAddress(value); setSmartPreview([]); }} placeholder="Enter route starting address" ariaLabel="Manual route starting address" />}
      </section>
      <section className="desktop-route-workspace">
        <MapCard title={smartPreview.length ? "Optimized route preview" : "Assigned customer map"} count={(smartPreview.length ? smartPreview : smartCandidates).length}>
          <EmployeeRouteMap route={smartPreview.length ? smartPreview : smartCandidates} originPoint={origin} desktop actionLabel="Property profile" onOpenVisit={setPropertyPreview} />
        </MapCard>
        <aside className="desktop-route-side">
          <div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{date}</span></div>
          <button className="btn btn-outline route-select-all" onClick={() => selectVisible(smartCandidates)}>Select assigned customers</button>
          <RouteButtons items={smartPreview.length ? smartPreview : smartCandidates} selected={selected} onClick={home => toggle(home.id)} label="Assigned" />
          <div className="desktop-route-build-box">
            {!smartPreview.length
              ? <button className="btn btn-primary" disabled={previewBusy || !selected.length || !employee} onClick={() => void generatePreview()}>{previewBusy ? "Optimizing..." : `Generate Preview (${selected.length})`}</button>
              : <><small>Review the origin, numbered stops and driving line before publishing.</small><button className="btn btn-primary" disabled={busy} onClick={() => void publishSmart()}>{busy ? "Publishing..." : `Confirm & Publish (${smartPreview.length})`}</button></>}
          </div>
        </aside>
      </section>
    </>}

    {mode === "move" && <section className="route-move-panel">
      <div className="route-move-row">
        <label><span>Remove from Employee</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}><option value="">Select an Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Current date</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      </div>
      <RouteButtons items={moveCandidates} selected={selected} onClick={home => toggle(home.id)} label={employee?.name || "Assigned"} />
      <div className="route-move-divider">Move selected houses to</div>
      <div className="route-move-row">
        <label><span>Destination Employee</span><select value={targetEmployeeId} onChange={event => setTargetEmployeeId(event.target.value)}>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>New date</span><input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} /></label>
      </div>
      <button className="btn btn-primary route-move-submit" disabled={busy || !selected.length} onClick={() => void moveSelected()}>{busy ? "Moving..." : `Move ${selected.length} selected houses`}</button>
    </section>}

    <CustomerPropertyModal property={propertyPreview} onClose={() => setPropertyPreview(null)} onReturnToAvailable={returnToAvailable} busy={busy} />

    <style jsx global>{`
      .route-controls-dynamic{grid-template-columns:repeat(3,minmax(180px,1fr))}
      .route-controls-view{grid-template-columns:minmax(180px,260px) minmax(260px,1fr)}
      .desktop-route-controls .route-search input{width:100%}
      .route-select-all{margin:14px 14px 0;width:calc(100% - 28px)}
      .route-map-legend{display:flex;gap:18px;padding:12px 16px;border-top:1px solid #e3ece7}
      .route-map-legend span{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12px}
      .route-map-legend i{width:12px;height:12px;border-radius:50%}
      .route-map-legend .green{background:#16a34a}.route-map-legend .blue{background:#2563eb}.route-map-legend .origin{background:#111827}
      .route-employee-directory{margin-top:18px;padding:20px;border:1px solid #dbe7e1;border-radius:22px;background:#fff}
      .route-employee-directory-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
      .route-employee-directory-head div{display:grid;gap:3px}.route-employee-directory-head strong{font-size:18px}.route-employee-directory-head span{color:#64748b;font-size:13px}
      .route-employee-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
      .route-employee-card{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:12px;padding:16px;text-align:left;border:1px solid #d9e6df;border-radius:16px;background:#fdfefe;cursor:pointer;transition:.18s ease}
      .route-employee-card:hover{transform:translateY(-1px);border-color:#0b7655;box-shadow:0 10px 28px rgba(15,75,56,.08)}
      .route-employee-card>span{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#0b7655;color:#fff;font-weight:900}
      .route-employee-card>div{display:grid;gap:4px;min-width:0}.route-employee-card strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.route-employee-card small{color:#64748b}
      .route-employee-card>b{font-size:12px;color:#0b7655;padding:7px 9px;border-radius:999px;background:#eaf7f1;white-space:nowrap}
      .desktop-route-side .desktop-route-list{max-height:680px;overflow:auto}
      .smart-route-start-card{display:grid;grid-template-columns:minmax(220px,1fr) repeat(2,minmax(220px,1fr));gap:12px;margin-top:18px;padding:18px;border:1px solid #dbe7e1;border-radius:20px;background:#fff}
      .smart-route-start-card>div{display:grid;align-content:center}.smart-route-start-card label{display:flex;gap:10px;align-items:center;padding:13px;border:1px solid #d8e5df;border-radius:14px}.smart-route-start-card label.selected{border-color:#0b7655;background:#eef8f3}.smart-route-start-card label span{display:grid}
      .route-move-panel{display:grid;gap:18px;margin-top:18px;padding:22px;border:1px solid #dbe7e1;border-radius:22px;background:#fff}.route-move-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.route-move-row label{display:grid;gap:7px}.route-move-row select,.route-move-row input{min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px}.route-move-divider{text-align:center;font-weight:900;color:#0b684c;padding:12px;border-block:1px solid #e4ece8}.route-move-submit{width:100%}
      @media(max-width:900px){.route-controls-dynamic,.route-controls-view,.route-move-row,.smart-route-start-card{grid-template-columns:1fr}.desktop-route-workspace{grid-template-columns:1fr}.route-employee-grid{grid-template-columns:1fr}}
    `}</style>
  </section>;
}

function MapCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>{title}</strong><span>{count} properties</span></div></div>{children}</article>;
}

function EmployeeDirectory({ employees, counts, date, onOpen }: { employees: RouteEmployee[]; counts: Map<string, number>; date: string; onOpen: (employee: RouteEmployee) => void }) {
  return <section className="route-employee-directory">
    <div className="route-employee-directory-head"><div><strong>Employees on Route Plan</strong><span>Select a worker to open their numbered houses and driving route.</span></div><b>{date}</b></div>
    <div className="route-employee-grid">
      {employees.map((employee, index) => {
        const count = counts.get(employee.id) || 0;
        return <button key={employee.id} className="route-employee-card" onClick={() => onOpen(employee)}>
          <span>{index + 1}</span>
          <div><strong>{employee.name}</strong><small>{employee.routeStartAddress || employee.email || "Starting address not saved"}</small></div>
          <b>{count} stop{count === 1 ? "" : "s"}</b>
        </button>;
      })}
      {!employees.length && <div className="desktop-route-empty"><strong>No active Employees found.</strong></div>}
    </div>
  </section>;
}

function RouteList({ items, onClick, empty }: { items: RouteLead[]; onClick: (home: RouteLead) => void; empty: string }) {
  return <aside className="desktop-route-side"><div className="desktop-route-list">
    {items.map((home, index) => <button key={home.canonicalVisitId || home.id} onClick={() => onClick(home)}><b>{home.routeOrder || index + 1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service}</small></div><i className="done">Assigned</i></button>)}
    {!items.length && <div className="desktop-route-empty"><strong>{empty}</strong></div>}
  </div></aside>;
}

function RouteButtons({ items, selected, onClick, label }: { items: RouteLead[]; selected: string[]; onClick: (home: RouteLead) => void; label: string }) {
  return <div className="desktop-route-list">
    {items.map((home, index) => <button key={home.id} className={selected.includes(home.id) ? "selected" : ""} onClick={() => onClick(home)}><b>{index + 1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service}</small></div><i className={home.canonicalCrewId ? "done" : ""}>{label}</i></button>)}
    {!items.length && <div className="desktop-route-empty"><strong>No matching properties.</strong></div>}
  </div>;
}
