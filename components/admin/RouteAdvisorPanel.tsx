"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import type {
  DispatchJob,
  DispatchVisit,
  SchedulingDispatchBoard,
} from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

function jobLabel(job: DispatchJob) {
  return `${job.customerName || "Customer"} — ${job.address || "Address missing"}`;
}

export function RouteAdvisorPanel() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [assignedJobs, setAssignedJobs] = useState<DispatchJob[]>([]);
  const [visits, setVisits] = useState<DispatchVisit[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(operationalDateKey());
  const [orderedJobIds, setOrderedJobIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading permanent assignments...");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setMessage("Loading permanent assignments...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/routes", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Route data could not be loaded.");

      const nextEmployees: RouteEmployee[] = result.employees || [];
      const board = (result.board || {}) as SchedulingDispatchBoard;
      setEmployees(nextEmployees);
      setAssignedJobs(Array.isArray(board.assignedJobs) ? board.assignedJobs : []);
      setVisits(Array.isArray(board.visits) ? board.visits : []);
      setEmployeeId(current => nextEmployees.some(item => item.id === current)
        ? current
        : nextEmployees[0]?.id || "");
      if (!silent) setMessage(nextEmployees.length ? "" : "Add an active Employee before building routes.");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Route data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const employee = employees.find(item => item.id === employeeId) || null;
  const ownedJobs = useMemo(() => {
    if (!employee) return [];
    return assignedJobs
      .filter(job => job.crewId === employee.crewId)
      .sort((left, right) =>
        (left.defaultRouteOrder ?? 9999) - (right.defaultRouteOrder ?? 9999)
        || (left.address || "").localeCompare(right.address || ""));
  }, [assignedJobs, employee]);

  const publishedVisits = useMemo(() => {
    if (!employee) return [];
    return visits
      .filter(visit => visit.scheduledDate === date
        && visit.employeeId === employee.employeeId
        && visit.status !== "cancelled")
      .sort((left, right) =>
        (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
        || left.id.localeCompare(right.id));
  }, [visits, date, employee]);

  useEffect(() => {
    setOrderedJobIds(ownedJobs.map(job => job.id));
  }, [employeeId, ownedJobs.map(job => job.id).join("|")]);

  const jobById = useMemo(
    () => new Map(ownedJobs.map(job => [job.id, job])),
    [ownedJobs],
  );
  const normalized = query.trim().toLowerCase();
  const orderedJobs = orderedJobIds.map(id => jobById.get(id)).filter(Boolean) as DispatchJob[];
  const visibleJobs = orderedJobs.filter(job =>
    !normalized
    || `${job.customerName || ""} ${job.address || ""} ${job.serviceName || ""}`.toLowerCase().includes(normalized));
  const excludedJobs = ownedJobs.filter(job => !orderedJobIds.includes(job.id));

  function changeEmployee(next: string) {
    setEmployeeId(next);
    setQuery("");
    setMessage("");
  }

  function toggleJob(jobId: string) {
    setOrderedJobIds(current => current.includes(jobId)
      ? current.filter(id => id !== jobId)
      : [...current, jobId]);
  }

  function move(jobId: string, direction: -1 | 1) {
    setOrderedJobIds(current => {
      const index = current.indexOf(jobId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function publish() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!orderedJobIds.length) {
      setMessage("Keep at least one permanently assigned house in the route.");
      return;
    }
    if (orderedJobIds.some(id => !ownedJobs.some(job => job.id === id))) {
      setMessage("The route contains a house that no longer belongs to this Employee. Refresh and try again.");
      return;
    }

    setBusy(true);
    setMessage(`Publishing ${orderedJobIds.length} house${orderedJobIds.length === 1 ? "" : "s"} for ${employee.name}...`);
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "publish",
          employeeId: employee.employeeId,
          crewId: employee.crewId,
          routeDate: date,
          orderedJobIds,
          sourceVisitIds: [],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The route could not be published.");
      if (!result.assignmentVerified || Number(result.count) !== orderedJobIds.length) {
        throw new Error("The route did not pass final Employee verification.");
      }

      await refresh(true);
      setMessage(`${orderedJobIds.length} houses published for ${employee.name} on ${date}. The Employee ID was verified.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The route could not be published.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="owner-route-advisor">
    <header className="owner-route-hero">
      <div>
        <span>DAILY ROUTE</span>
        <h2>Only the selected Employee’s permanent houses.</h2>
        <p>Build defines ownership. This screen only chooses the day and order for those owned houses.</p>
      </div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>
        Refresh
      </button>
    </header>

    <section className="owner-route-controls">
      <label>
        <span>Employee</span>
        <select value={employeeId} onChange={event => changeEmployee(event.target.value)}>
          <option value="">Select Employee</option>
          {employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>
        <span>Route date · Toronto</span>
        <input type="date" value={date} onChange={event => setDate(event.target.value)} />
      </label>
      <label>
        <span>Search this Employee’s houses</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Customer, address or service" />
      </label>
    </section>

    {message && <div className="desktop-route-message" role="status" aria-live="polite">{message}</div>}

    <section className="owner-route-summary">
      <div><small>PERMANENT OWNER</small><strong>{employee?.name || "Choose Employee"}</strong></div>
      <div><small>OWNED HOUSES</small><strong>{ownedJobs.length}</strong></div>
      <div><small>IN THIS ROUTE</small><strong>{orderedJobIds.length}</strong></div>
      <div><small>ALREADY PUBLISHED</small><strong>{publishedVisits.length}</strong></div>
    </section>

    {!employee ? <div className="owner-route-empty"><strong>Choose an Employee.</strong></div>
      : !ownedJobs.length ? <div className="owner-route-empty">
        <strong>No houses are permanently assigned to {employee.name}.</strong>
        <p>Use Build first. Houses assigned to another worker will never appear here.</p>
      </div>
        : <div className="owner-route-layout">
          <section className="owner-route-list">
            <header><strong>Route order</strong><span>{orderedJobIds.length} selected</span></header>
            {visibleJobs.map((job, index) => <article key={job.id}>
              <button type="button" className="owner-route-check active" onClick={() => toggleJob(job.id)} aria-label={`Remove ${job.customerName || "house"} from route`}>✓</button>
              <b>{orderedJobIds.indexOf(job.id) + 1}</b>
              <div><strong>{jobLabel(job)}</strong><small>{job.serviceName} · permanently assigned to {employee.name}</small></div>
              <nav>
                <button type="button" disabled={orderedJobIds.indexOf(job.id) === 0} onClick={() => move(job.id, -1)}>↑</button>
                <button type="button" disabled={orderedJobIds.indexOf(job.id) === orderedJobIds.length - 1} onClick={() => move(job.id, 1)}>↓</button>
              </nav>
            </article>)}
            {!visibleJobs.length && <div className="owner-route-empty"><strong>No matching houses.</strong></div>}
          </section>

          <aside className="owner-route-publish">
            <span>REVIEW</span>
            <h3>{employee.name} · {date}</h3>
            <p>Publishing creates dated Visits for this Employee only. Permanent ownership remains unchanged.</p>
            {excludedJobs.length > 0 && <section>
              <strong>{excludedJobs.length} excluded</strong>
              {excludedJobs.map(job => <button key={job.id} type="button" onClick={() => toggleJob(job.id)}>＋ {job.customerName || job.address || "House"}</button>)}
            </section>}
            <button type="button" className="btn btn-primary" disabled={busy || !orderedJobIds.length} onClick={() => void publish()}>
              {busy ? "Publishing…" : `Publish ${orderedJobIds.length} houses`}
            </button>
          </aside>
        </div>}

    <style jsx global>{`
      .owner-route-advisor{display:grid;gap:14px;min-width:0}.owner-route-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px;border:1px solid #dbe7e1;border-radius:22px;background:#fff}.owner-route-hero span,.owner-route-summary small,.owner-route-publish>span{color:#0b7046;font-size:10px;font-weight:950;letter-spacing:.12em}.owner-route-hero h2{margin:5px 0 6px;font-size:26px}.owner-route-hero p{margin:0;color:#617269}.owner-route-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px;border:1px solid #dbe7e1;border-radius:18px;background:#fff}.owner-route-controls label{display:grid;gap:6px}.owner-route-controls label>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.owner-route-controls input,.owner-route-controls select{min-height:48px;width:100%;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff}.owner-route-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.owner-route-summary>div{display:grid;gap:4px;padding:14px;border:1px solid #dbe7e1;border-radius:16px;background:#fff}.owner-route-summary strong{font-size:20px}.owner-route-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.65fr);gap:14px}.owner-route-list,.owner-route-publish{overflow:hidden;border:1px solid #dbe7e1;border-radius:20px;background:#fff}.owner-route-list>header{display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e8efeb}.owner-route-list>article{display:grid;grid-template-columns:36px 32px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #edf2ef}.owner-route-list article>div{display:grid;gap:3px}.owner-route-list article small{color:#67786f}.owner-route-list article nav{display:flex;gap:5px}.owner-route-list article nav button,.owner-route-check{width:36px;height:36px;border:1px solid #d4e1da;border-radius:10px;background:#fff;font-weight:950}.owner-route-check.active{border-color:#0b7046;background:#0b7046;color:#fff}.owner-route-list article nav button:disabled{opacity:.25}.owner-route-publish{display:grid;align-content:start;gap:10px;padding:18px}.owner-route-publish h3{margin:0;font-size:22px}.owner-route-publish p{margin:0;color:#617269;line-height:1.5}.owner-route-publish section{display:grid;gap:6px;margin:5px 0;padding:12px;border-radius:14px;background:#f3f7f5}.owner-route-publish section button{border:0;background:transparent;color:#0b7046;text-align:left;font-weight:800}.owner-route-publish>.btn{min-height:52px}.owner-route-empty{padding:22px;border:1px dashed #bfd1c7;border-radius:18px;background:#f8fbf9;color:#52675d;text-align:center}.owner-route-empty p{margin:5px 0 0}
      @media(max-width:760px){.owner-route-hero{padding:15px}.owner-route-hero h2{font-size:20px}.owner-route-controls{grid-template-columns:1fr}.owner-route-summary{grid-template-columns:1fr 1fr}.owner-route-layout{grid-template-columns:1fr}.owner-route-list>article{grid-template-columns:34px 26px minmax(0,1fr)}.owner-route-list article nav{grid-column:3}.owner-route-publish{padding:15px}}
    `}</style>
  </section>;
}
