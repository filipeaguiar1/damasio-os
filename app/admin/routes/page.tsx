"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { loadSchedulingDispatchBoard, publishJobRoutePattern, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { DispatchCrew } from "@/lib/repositories/schedulingRepository";
import type { Lead } from "@/lib/storage";

function todayKey() { return new Date().toISOString().slice(0, 10); }

export default function RoutesPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [employees, setEmployees] = useState<DispatchCrew[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("Loading routes...");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const board = await loadSchedulingDispatchBoard({ force: true });
      const realEmployees = (board.crews || []).filter((item) => item.id && item.name);
      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads(board));
      if (realEmployees.length && !realEmployees.some((item) => item.id === employeeId)) setEmployeeId(realEmployees[0].id);
      if (!realEmployees.length) setEmployeeId("");
      setMessage(realEmployees.length ? "" : "No Employees have been added yet. Add an Employee before publishing routes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const employee = employees.find((item) => item.id === employeeId) || null;
  const jobs = useMemo(() => leads.filter((item) => !item.canonicalVisitId), [leads]);
  const route = useMemo(() => {
    if (!employee) return [];
    return leads
      .filter((item) => item.assignedCrew === employee.name && item.scheduledDate === date)
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
  }, [leads, employee, date]);
  const candidates = useMemo(() => jobs.filter((item) => !item.assignedCrew || item.assignedCrew === employee?.name), [jobs, employee]);
  const selectedJobs = candidates.filter((item) => selected.includes(item.id));

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function publish() {
    if (!employee) { setMessage("Add a real Employee before creating a route."); return; }
    if (!selectedJobs.length) { setMessage("Select at least one accepted customer property."); return; }
    setBusy(true);
    try {
      for (let index = 0; index < selectedJobs.length; index++) {
        const item = selectedJobs[index];
        await publishJobRoutePattern({ jobId: item.canonicalJobId || item.id, crewId: employee.id, routeDate: date, routeOrder: index + 1 });
      }
      setSelected([]);
      setMessage("Route published to the selected Employee.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route could not be published.");
    } finally { setBusy(false); }
  }

  return <AdminShell active="Routes">
    <section className="desktop-route-studio">
      <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{employee ? `${route.length} stops for ${employee.name}.` : "No Employees yet."}</h1><p>Only real Employees from your company appear here. Customers become available after the company accepts the Master offer.</p></div><div className="desktop-route-actions"><button className="btn btn-outline" onClick={() => void refresh()} disabled={busy}>Refresh</button>{employee && <Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(employee.name)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}</div></header>

      <section className="desktop-route-controls"><label><span>Employee</span><select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setSelected([]); }} disabled={!employees.length}><option value="">{employees.length ? "Select Employee" : "No Employees added"}</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Day</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelected([]); }} /></label></section>

      {message && <div className="desktop-route-message">{message}</div>}

      {!employees.length ? <section className="card profile-card" style={{ marginTop: 18 }}><h2>No route team available</h2><p>Add the first Employee in the Employees area. Fake crews are no longer created or displayed.</p></section> : <section className="desktop-route-workspace">
        <article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>Route Map</strong><span>{route.length} stops</span></div></div><EmployeeRouteMap route={route} desktop actionLabel="Open visit" onOpenVisit={() => {}} /></article>
        <aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{candidates.length} available</span></div><div className="desktop-route-list">{candidates.map((home) => <button key={home.id} type="button" className={selected.includes(home.id) ? "selected" : ""} onClick={() => toggle(home.id)}><span>{home.name}</span><small>{home.address}</small></button>)}{!candidates.length && <div className="empty-state"><strong>No accepted customer jobs available.</strong><p>Accepted platform customers and company-created jobs will appear here.</p></div>}</div><button className="btn btn-primary" disabled={busy || !selected.length} onClick={() => void publish()}>{busy ? "Publishing..." : `Publish ${selected.length} stops`}</button></aside>
      </section>}
    </section>

    <style jsx global>{`
      .desktop-route-list{display:grid;gap:8px;margin-bottom:14px}.desktop-route-list button{display:grid;text-align:left;border:1px solid #d5e1db;background:#fff;border-radius:12px;padding:12px;cursor:pointer}.desktop-route-list button.selected{border-color:#0b684c;background:#edf8f3}.desktop-route-list button span{font-weight:850}.desktop-route-list button small{margin-top:4px;color:#667a71}.desktop-route-side>.btn{width:100%}.desktop-route-controls select:disabled{opacity:.65;cursor:not-allowed}
    `}</style>
  </AdminShell>;
}
