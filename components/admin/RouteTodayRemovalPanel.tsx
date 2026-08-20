"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CanonicalVisitDetailDrawer } from "@/components/operations/CanonicalVisitDetailDrawer";
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

function announceRouteUpdates(routeIds: string[], source = "admin_route_view") {
  for (const routeId of routeIds) {
    window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", {
      detail: { routeId, source },
    }));
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("damasio-canonical-route");
    for (const routeId of routeIds) channel.postMessage({ routeId, source });
    channel.close();
  }
}

function statusLabel(value?: string) {
  return String(value || "scheduled").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function duration(seconds?: number) {
  if (!Number.isFinite(Number(seconds))) return "";
  const minutes = Math.max(0, Math.round(Number(seconds) / 60));
  return `${minutes} min`;
}

export function RouteTodayRemovalPanel() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const visible = !requestedTab || requestedTab === "view";
  const [date, setDate] = useState(operationalDateKey());
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("Customer requested a different service day");
  const [cancelReason, setCancelReason] = useState("Customer cancelled this service");
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
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
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [visible, date]);

  const employee = employees.find(item => item.id === employeeId) || null;
  const route = useMemo(() => {
    if (!employee) return [];
    const normalized = query.trim().toLowerCase();
    return canonicalRouteLeadsForEmployee(
      leads.filter(item => Boolean(item.canonicalVisitId) && item.scheduledDate === date && item.canonicalVisitStatus !== "cancelled"),
      { id: employee.employeeId || employee.id, crewId: employee.crewId },
    )
      .filter(item => !normalized || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized))
      .sort((left, right) => (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999));
  }, [leads, employee, date, query]);

  const removable = useMemo(() => route.filter(item => item.canonicalVisitStatus === "scheduled"), [route]);

  useEffect(() => {
    const available = new Set(removable.map(visitId));
    setSelected(current => current.filter(id => available.has(id)));
  }, [removable]);

  function toggle(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
  }

  async function removeVisits(ids: string[]) {
    if (!ids.length || reason.trim().length < 3) return;
    const confirmed = window.confirm(
      `Remove ${ids.length} scheduled visit${ids.length === 1 ? "" : "s"} from ${date}? The service remains active and can be rescheduled.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("Removing from this day and rebuilding the canonical route…");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
        body: JSON.stringify({ action: "remove_today", visitIds: ids, removalReason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Visits could not be removed from this day.");
      const routeIds = [...new Set([...(Array.isArray(result.routeIds) ? result.routeIds : []), result.routeId].map(String).filter(Boolean))];
      setSelected(current => current.filter(id => !ids.includes(id)));
      announceRouteUpdates(routeIds, "admin_remove_from_today");
      await refresh(true);
      window.setTimeout(() => { announceRouteUpdates(routeIds, "admin_remove_from_today"); void refresh(true); }, 450);
      setMessage(`${ids.length} Visit${ids.length === 1 ? "" : "s"} removed from this day. The Job remains active for rescheduling.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Visits could not be removed from this day.");
    } finally { setBusy(false); }
  }

  async function cancelService(home: RouteLead) {
    const id = visitId(home);
    if (home.canonicalVisitStatus !== "scheduled") return;
    const confirmed = window.confirm(
      `Cancel the service for ${home.name} at ${home.address} on ${date}? This Visit will be removed from the route and from any pending payout flow.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("Cancelling the service and synchronizing route + payout state…");
    try {
      const client = getSupabaseBrowserClient() as any;
      const { data, error } = await client.rpc("cancel_scheduled_visit", { p_visit_id: id, p_reason: cancelReason.trim() });
      if (error) throw new Error(error.message);
      const routeIds = [...new Set((data?.routeIds || []).map(String).filter(Boolean))];
      announceRouteUpdates(routeIds, "admin_cancel_service");
      setSelected(current => current.filter(value => value !== id));
      if (selectedVisitId === id) setSelectedVisitId(null);
      await refresh(true);
      setMessage("Service cancelled. It left the worker route and any pending payout path automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The service could not be cancelled.");
    } finally { setBusy(false); }
  }

  if (!visible) return null;

  return <section className="route-day-view">
    <header>
      <div><span>VIEW · DAILY OPERATIONS</span><h2>{employee?.name || "Employee route"}</h2><p>One canonical view of the worker&apos;s houses. View evidence, move work, remove only this day, or cancel a Scheduled Visit.</p></div>
      <strong>{route.length} house{route.length === 1 ? "" : "s"}</strong>
    </header>

    <div className="route-day-controls">
      <label><span>Employee</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected([]); }}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Route date</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /></label>
      <label className="route-day-search"><span>Search houses</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Customer, address or service" /></label>
      <button className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Working…" : "Refresh"}</button>
    </div>

    {message && <div className="desktop-route-message">{message}</div>}

    <div className="route-day-list">
      {route.map((home, index) => {
        const id = visitId(home);
        const status = home.canonicalVisitStatus || "scheduled";
        const canChange = status === "scheduled";
        const active = selected.includes(id);
        return <article key={id} className={`route-day-row ${status}`}>
          <button className={`route-day-check ${active ? "selected" : ""}`} disabled={!canChange} onClick={() => canChange && toggle(id)} aria-label={canChange ? "Select scheduled Visit" : `${statusLabel(status)} Visit`}><b>{home.routeOrder || index + 1}</b></button>
          <button className="route-day-service" onClick={()=>setSelectedVisitId(id)}>
            <span><strong>{home.name}</strong><small>{home.address}</small><em>{home.service}</em></span>
            <div><strong>{statusLabel(status)}</strong><small>{home.visitFinishedAt ? `Finished · ${duration(home.visitDurationSeconds)}` : home.visitStartedAt ? "Service in progress" : "Scheduled service"}</small></div>
          </button>
          <div className="route-day-actions">
            <button onClick={()=>setSelectedVisitId(id)}>View service</button>
            <button disabled={!canChange || busy} onClick={()=>{ window.location.href = `/admin/routes?tab=move&visitId=${encodeURIComponent(id)}`; }}>Move</button>
            <button disabled={!canChange || busy} onClick={()=>void removeVisits([id])}>Remove from day</button>
            <button className="danger" disabled={!canChange || busy} onClick={()=>void cancelService(home)}>Cancel service</button>
          </div>
        </article>;
      })}
      {!route.length && <div className="desktop-route-empty"><strong>No houses on this Employee route for the selected date.</strong><p>Choose another Employee/date or publish a route in Route Advisor.</p></div>}
    </div>

    {!!removable.length && <section className="route-day-bulk">
      <div><label><span>Remove-from-day reason</span><select value={reason} onChange={event => setReason(event.target.value)}><option>Customer requested a different service day</option><option>Weather or access issue</option><option>Operational capacity adjustment</option><option>Other administrative reason</option></select></label><label><span>Cancellation reason</span><select value={cancelReason} onChange={event=>setCancelReason(event.target.value)}><option>Customer cancelled this service</option><option>Customer no longer needs service</option><option>Duplicate scheduled service</option><option>Company cancelled service</option><option>Other cancellation reason</option></select></label></div>
      <footer><button className="btn btn-outline" disabled={busy} onClick={()=>setSelected(selected.length===removable.length?[]:removable.map(visitId))}>{selected.length===removable.length&&removable.length?"Clear scheduled":"Select all scheduled"}</button><button className="btn btn-primary" disabled={!selected.length||busy} onClick={()=>void removeVisits(selected)}>Remove selected from day ({selected.length})</button></footer>
    </section>}

    <CanonicalVisitDetailDrawer visitId={selectedVisitId} onClose={()=>setSelectedVisitId(null)} />

    <style jsx global>{`
      .route-day-view{display:grid;gap:14px;margin-top:18px;padding:18px;border:1px solid #bfd7cc;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.05)}.route-day-view>header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.route-day-view>header span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.12em}.route-day-view>header h2{margin:5px 0;font-size:25px}.route-day-view>header p{margin:0;color:#64748b}.route-day-view>header>strong{padding:9px 12px;border-radius:999px;background:#e8f5ee;color:#0b684c;white-space:nowrap}.route-day-controls{display:grid;grid-template-columns:1fr 210px 1.25fr auto;gap:10px;align-items:end}.route-day-controls label,.route-day-bulk label{display:grid;gap:5px}.route-day-controls label>span,.route-day-bulk label>span{color:#607168;font-size:9px;font-weight:900;text-transform:uppercase}.route-day-controls input,.route-day-controls select,.route-day-bulk select{min-height:46px;border:1px solid #cbdad2;border-radius:11px;padding:0 12px;background:#fff}
      .route-day-list{display:grid;gap:8px}.route-day-row{display:grid;grid-template-columns:42px minmax(250px,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid #dde8e2;border-radius:15px;background:#fff}.route-day-row:hover{border-color:#b6d1c5;box-shadow:0 8px 22px rgba(13,61,44,.05)}.route-day-row.completed{background:#f7faf8}.route-day-row.in_progress{border-color:#9cc6b4;background:#f0f8f4}.route-day-check{border:0;background:transparent;padding:0;cursor:pointer}.route-day-check:disabled{cursor:default}.route-day-check b{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#e9f2ed;color:#0b684c}.route-day-check.selected b{background:#1d4ed8;color:#fff}.route-day-service{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;border:0;background:transparent;text-align:left;cursor:pointer;padding:3px}.route-day-service span strong,.route-day-service span small,.route-day-service span em,.route-day-service div strong,.route-day-service div small{display:block}.route-day-service span small{margin-top:2px;color:#5f7167}.route-day-service span em{margin-top:4px;color:#0b684c;font-size:11px;font-style:normal;font-weight:800}.route-day-service div{text-align:right}.route-day-service div strong{font-size:10px;text-transform:uppercase;color:#0b684c}.route-day-service div small{margin-top:3px;color:#75847c}.route-day-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.route-day-actions button{border:1px solid #cddbd3;border-radius:9px;background:#fff;color:#315b4b;padding:7px 9px;font-size:10px;font-weight:850;cursor:pointer}.route-day-actions button:hover:not(:disabled){border-color:#0b7655;background:#eff8f3}.route-day-actions button.danger{color:#a33b33;border-color:#e5c2be}.route-day-actions button.danger:hover:not(:disabled){background:#fff0ee;border-color:#c85d52}.route-day-actions button:disabled{opacity:.4;cursor:not-allowed}.route-day-bulk{display:grid;gap:10px;padding:13px;border:1px solid #e0e9e4;border-radius:15px;background:#f8fbf9}.route-day-bulk>div{display:grid;grid-template-columns:1fr 1fr;gap:10px}.route-day-bulk footer{display:flex;justify-content:flex-end;gap:8px}
      @media(max-width:1100px){.route-day-controls{grid-template-columns:1fr 1fr}.route-day-row{grid-template-columns:42px 1fr}.route-day-actions{grid-column:2;justify-content:flex-start}}
      @media(max-width:680px){.route-day-view>header{flex-direction:column}.route-day-controls{grid-template-columns:1fr}.route-day-service{grid-template-columns:1fr}.route-day-service div{text-align:left}.route-day-bulk>div{grid-template-columns:1fr}.route-day-bulk footer{flex-direction:column}.route-day-bulk footer .btn{width:100%}}
    `}</style>
  </section>;
}
