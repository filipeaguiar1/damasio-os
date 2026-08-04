"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
};

function visitId(item: RouteLead) {
  return item.canonicalVisitId || item.id;
}

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token as string;
}

function announceRouteUpdates(routeIds: string[]) {
  for (const routeId of routeIds) {
    window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", {
      detail: { routeId, source: "admin_remove_from_today" },
    }));
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("damasio-canonical-route");
    for (const routeId of routeIds) {
      channel.postMessage({ routeId, source: "admin_remove_from_today" });
    }
    channel.close();
  }
}

export function RouteTodayRemovalPanel() {
  const searchParams = useSearchParams();
  const visible = searchParams.get("tab") === "advisor";
  const [date, setDate] = useState(operationalDateKey());
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("Customer requested a different service day");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(silent = false) {
    try {
      const token = await accessToken();
      const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(date)}&t=${Date.now()}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Routes could not be loaded.");
      const nextEmployees: RouteEmployee[] = result.employees || [];
      setEmployees(nextEmployees);
      setLeads(schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard));
      setEmployeeId(current => nextEmployees.some(item => item.id === current)
        ? current
        : nextEmployees[0]?.id || "");
      if (!silent) setMessage("");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [visible, date]);

  const employee = employees.find(item => item.id === employeeId) || null;
  const route = useMemo(() => {
    if (!employee) return [];
    return canonicalRouteLeadsForEmployee(
      leads.filter(item => Boolean(item.canonicalVisitId) && item.scheduledDate === date),
      { id: employee.employeeId || employee.id, crewId: employee.crewId },
    )
      .filter(item => item.canonicalVisitStatus === "scheduled")
      .sort((left, right) => (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999));
  }, [leads, employee, date]);

  useEffect(() => {
    const available = new Set(route.map(visitId));
    setSelected(current => current.filter(id => available.has(id)));
  }, [route]);

  function toggle(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
  }

  async function removeSelected() {
    if (!selected.length || reason.trim().length < 3) return;
    const confirmed = window.confirm(
      `Remove ${selected.length} scheduled visit${selected.length === 1 ? "" : "s"} from ${date}? They will remain pending and available for rescheduling.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("Removing selected visits and rebuilding the canonical route now...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "remove_today",
          visitIds: selected,
          removalReason: reason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Visits could not be removed from today.");

      const count = Number(result.count || selected.length);
      const routeIds = [...new Set([
        ...(Array.isArray(result.routeIds) ? result.routeIds : []),
        result.routeId,
      ].map(String).filter(Boolean))];

      setSelected([]);
      announceRouteUpdates(routeIds);
      await refresh(true);
      window.setTimeout(() => {
        announceRouteUpdates(routeIds);
        void refresh(true);
      }, 500);

      setMessage(`${count} visit${count === 1 ? "" : "s"} removed. The worker route and map were rebuilt automatically.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Visits could not be removed from today.");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return <section className="route-today-removal">
    <header>
      <div>
        <span>REMOVE FROM TODAY</span>
        <h2>Keep the Job, remove only today&apos;s Visit.</h2>
        <p>Selected visits leave the worker&apos;s route and return to Pending for rescheduling. Customer, Property and Job remain unchanged.</p>
      </div>
      <strong>{selected.length} selected</strong>
    </header>

    <div className="route-today-removal-controls">
      <label><span>Employee</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Route date</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /></label>
      <label><span>Reason</span><select value={reason} onChange={event => setReason(event.target.value)}><option>Customer requested a different service day</option><option>Customer cancelled today&apos;s visit</option><option>Weather or access issue</option><option>Operational capacity adjustment</option><option>Other administrative reason</option></select></label>
      <button className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Working..." : "Refresh"}</button>
    </div>

    {message && <div className="desktop-route-message">{message}</div>}

    <div className="route-today-removal-list">
      {route.map((home, index) => {
        const id = visitId(home);
        const active = selected.includes(id);
        return <button key={id} type="button" className={active ? "selected" : "scheduled"} onClick={() => toggle(id)}>
          <b>{home.routeOrder || index + 1}</b>
          <span><strong>{home.name}</strong><small>{home.address} · {home.service}</small></span>
          <em>{active ? "Selected to remove" : "On today’s route"}</em>
        </button>;
      })}
      {!route.length && <div className="desktop-route-empty"><strong>No removable Scheduled Visits for this Employee/date.</strong><p>Completed and active visits remain protected.</p></div>}
    </div>

    <footer>
      <button type="button" className="btn btn-outline" disabled={!route.length || busy} onClick={() => setSelected(selected.length === route.length ? [] : route.map(visitId))}>{selected.length === route.length && route.length ? "Clear all" : "Select all scheduled"}</button>
      <button type="button" className="btn btn-primary" disabled={!selected.length || busy || reason.trim().length < 3} onClick={() => void removeSelected()}>{busy ? "Removing..." : `Remove from today (${selected.length})`}</button>
    </footer>

    <style jsx global>{`
      .route-today-removal{display:grid;gap:14px;margin-top:18px;padding:18px;border:1px solid #bfd7cc;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.05)}
      .route-today-removal>header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.route-today-removal>header span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.12em}.route-today-removal>header h2{margin:5px 0;font-size:25px}.route-today-removal>header p{margin:0;color:#64748b}.route-today-removal>header>strong{padding:9px 12px;border-radius:999px;background:#e8f5ee;color:#0b684c;white-space:nowrap}
      .route-today-removal-controls{display:grid;grid-template-columns:1fr 210px 1.4fr auto;gap:10px;align-items:end}.route-today-removal-controls label{display:grid;gap:5px}.route-today-removal-controls label>span{color:#607168;font-size:9px;font-weight:900;text-transform:uppercase}.route-today-removal-controls input,.route-today-removal-controls select{min-height:46px;border:1px solid #cbdad2;border-radius:11px;padding:0 12px;background:#fff}
      .route-today-removal-list{display:grid;gap:8px}.route-today-removal-list>button{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;padding:13px;border:1px solid #8db9a5;border-radius:14px;background:#e8f5ee;text-align:left;cursor:pointer}.route-today-removal-list>button:hover{border-color:#0b7655}.route-today-removal-list>button.selected{border-color:#1d4ed8;background:#e8efff;box-shadow:0 0 0 2px rgba(29,78,216,.1)}.route-today-removal-list b{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#0b7655;color:#fff}.route-today-removal-list .selected b{background:#1d4ed8}.route-today-removal-list span strong,.route-today-removal-list span small{display:block}.route-today-removal-list span small{margin-top:3px;color:#566b61}.route-today-removal-list em{font-style:normal;font-size:10px;font-weight:950;color:#0b684c}.route-today-removal-list .selected em{color:#1d4ed8}
      .route-today-removal>footer{display:flex;justify-content:flex-end;gap:10px}
      @media(max-width:900px){.route-today-removal-controls{grid-template-columns:1fr 1fr}.route-today-removal>header{flex-direction:column}.route-today-removal-list>button{grid-template-columns:36px 1fr}.route-today-removal-list em{grid-column:2}}
      @media(max-width:620px){.route-today-removal-controls{grid-template-columns:1fr}.route-today-removal>footer{flex-direction:column}.route-today-removal>footer .btn{width:100%}}
    `}</style>
  </section>;
}
