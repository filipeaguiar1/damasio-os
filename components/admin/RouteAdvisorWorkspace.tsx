"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteAdvisorPanel } from "@/components/admin/RouteAdvisorPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
};

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

function frequencyLabel(value?: string) {
  const normalized = String(value || "one_time").toLowerCase();
  if (["weekly", "week"].includes(normalized)) return "Weekly";
  if (["biweekly", "bi_weekly", "every_2_weeks"].includes(normalized)) return "Biweekly";
  if (["monthly", "month"].includes(normalized)) return "Monthly";
  return "One-time";
}

function weekday(date?: string) {
  if (!date) return "Unscheduled";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "America/Toronto" })
    .format(new Date(Date.UTC(y, m - 1, d, 17)));
}

export function RouteAdvisorWorkspace() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [jobs, setJobs] = useState<RouteLead[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [referenceDate, setReferenceDate] = useState(operationalDateKey());
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function refreshReferenceData() {
    try {
      const token = await accessToken();
      const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(referenceDate)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Route reference data could not be loaded.");
      const realEmployees: RouteEmployee[] = result.employees || [];
      const leads = schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard);
      setEmployees(realEmployees);
      setJobs(leads.filter(item => !item.canonicalVisitId));
      setEmployeeId(current => realEmployees.some(item => item.id === current) ? current : realEmployees[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route reference data could not be loaded.");
    }
  }

  useEffect(() => { void refreshReferenceData(); }, [referenceDate]);

  const employee = employees.find(item => item.id === employeeId) || null;
  const employeeJobs = useMemo(() => employee
    ? jobs.filter(item => item.canonicalCrewId === employee.crewId)
    : [], [jobs, employee?.crewId]);

  const recurringJobs = useMemo(() => employeeJobs.filter(item =>
    frequencyLabel(item.serviceFrequency) !== "One-time"), [employeeJobs]);

  const weeklyDistribution = useMemo(() => {
    const result = new Map<string, number>();
    for (const job of recurringJobs) {
      const day = weekday(job.scheduledDate || job.nextVisitDate);
      result.set(day, (result.get(day) || 0) + 1);
    }
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map(day => ({ day, count: result.get(day) || 0 }));
  }, [recurringJobs]);

  async function applyRecurringReference() {
    if (!employee) return;
    const confirmed = window.confirm(
      `Use ${employee.name}'s published route on ${referenceDate} as the recurring reference? Weekly, biweekly and monthly Jobs will materialize future Visits without duplicating existing dates. One-time Jobs will not repeat.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("Applying the recurring route reference...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-recurring-reference", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employeeId: employee.employeeId || employee.id,
          crewId: employee.crewId,
          routeDate: referenceDate,
          horizonWeeks,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Recurring route reference could not be applied.");
      setMessage(
        `Recurring reference saved: ${result.recurringJobs} recurring Job${result.recurringJobs === 1 ? "" : "s"}, ${result.createdVisits} future Visit${result.createdVisits === 1 ? "" : "s"} materialized, ${result.preservedVisits} existing Visit${result.preservedVisits === 1 ? "" : "s"} preserved.`,
      );
      await refreshReferenceData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recurring route reference could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="route-advisor-v2">
    <RouteAdvisorPanel />

    <section className="recurring-reference-card">
      <div className="recurring-reference-copy">
        <span>RECURRING ROUTE REFERENCE</span>
        <h3>Use a reviewed published route as the future pattern.</h3>
        <p>Publishing the daily route remains a separate Admin decision. This step only runs when you explicitly apply the recurring reference.</p>
      </div>
      <div className="recurring-reference-controls">
        <label><span>Employee</span><select value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">Select Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Published reference date</span><input type="date" value={referenceDate} onChange={event => setReferenceDate(event.target.value)} /></label>
        <label><span>Planning horizon</span><select value={horizonWeeks} onChange={event => setHorizonWeeks(Number(event.target.value))}><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option><option value={26}>26 weeks</option><option value={52}>52 weeks</option></select></label>
      </div>
      <div className="recurring-reference-stats">
        <div><strong>{employeeJobs.length}</strong><span>Owned Jobs</span></div>
        <div><strong>{recurringJobs.length}</strong><span>Recurring</span></div>
        <div><strong>{employeeJobs.length - recurringJobs.length}</strong><span>One-time</span></div>
      </div>
      <div className="recurring-reference-action">
        <div><strong>Weekly / biweekly / monthly follow the contract.</strong><small>Existing non-cancelled Visits on the same Job/date are preserved instead of duplicated.</small></div>
        <button className="btn btn-primary" type="button" disabled={busy || !employee} onClick={() => void applyRecurringReference()}>{busy ? "Applying..." : "Use as recurring route reference"}</button>
      </div>
      {message && <div className="recurring-reference-message">{message}</div>}
    </section>

    <section className="advanced-route-planning">
      <button type="button" className="advanced-route-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(current => !current)}>
        <span><b>Advanced Route Planning</b><small>Bulk week planning and future route rebuild tools</small></span><i>{advancedOpen ? "−" : "+"}</i>
      </button>
      {advancedOpen && <div className="advanced-route-body">
        <div className="advanced-route-intro"><span>ADVANCED</span><h3>Plan the week before changing the canonical routes.</h3><p>This view is advisory first: it shows the current recurring load by likely service day. Nothing is published from this section automatically.</p></div>
        <div className="advanced-week-grid">{weeklyDistribution.map(item => <div key={item.day}><strong>{item.count}</strong><span>{item.day}</span></div>)}</div>
        <div className="advanced-route-roadmap"><div><b>Distribute several houses</b><span>Select a group and balance Monday–Sunday before publication.</span></div><div><b>Suggest better days</b><span>Use proximity and current regional load instead of arbitrary percentages.</span></div><div><b>Rebuild all routes</b><span>Reserved as an explicit high-impact Admin action, never automatic.</span></div></div>
      </div>}
    </section>

    <style jsx global>{`
      .route-advisor-v2{display:grid;gap:18px}.route-advisor-v2 .advisor-recommend,.route-advisor-v2 .advisor-recommendations{display:none!important}.recurring-reference-card,.advanced-route-planning{border:1px solid #d7e6de;border-radius:24px;background:#fff;box-shadow:0 12px 35px rgba(15,61,43,.06);overflow:hidden}.recurring-reference-card{display:grid;gap:16px;padding:22px}.recurring-reference-copy>span,.advanced-route-intro>span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.13em}.recurring-reference-copy h3,.advanced-route-intro h3{margin:5px 0 6px;color:#123b2d;font-size:24px}.recurring-reference-copy p,.advanced-route-intro p{margin:0;color:#687a72;line-height:1.55}.recurring-reference-controls{display:grid;grid-template-columns:1.1fr 1fr 180px;gap:10px}.recurring-reference-controls label{display:grid;gap:6px}.recurring-reference-controls label>span{font-size:10px;font-weight:900;color:#607168;text-transform:uppercase}.recurring-reference-controls select,.recurring-reference-controls input{min-height:46px;border:1px solid #cbdad2;border-radius:12px;background:#fff;padding:0 12px}.recurring-reference-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.recurring-reference-stats div,.advanced-week-grid div{display:grid;gap:3px;padding:13px;border-radius:14px;background:#f4f9f6}.recurring-reference-stats strong,.advanced-week-grid strong{font-size:22px;color:#0b5f42}.recurring-reference-stats span,.advanced-week-grid span{font-size:11px;color:#6b7e74}.recurring-reference-action{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:5px}.recurring-reference-action strong,.recurring-reference-action small{display:block}.recurring-reference-action small{margin-top:4px;color:#6b7e74}.recurring-reference-message{padding:12px 14px;border-radius:12px;background:#edf8f2;color:#176344}.advanced-route-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;padding:20px 22px;border:0;background:#fff;text-align:left;cursor:pointer;color:#173a2c}.advanced-route-toggle span{display:grid;gap:3px}.advanced-route-toggle small{color:#718078;font-weight:500}.advanced-route-toggle i{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#edf7f1;font-style:normal;font-size:22px;color:#0b7655}.advanced-route-body{display:grid;gap:16px;padding:0 22px 22px;border-top:1px solid #edf2ef}.advanced-route-intro{padding-top:18px}.advanced-week-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.advanced-week-grid div{text-align:center}.advanced-route-roadmap{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.advanced-route-roadmap div{display:grid;gap:5px;padding:14px;border:1px solid #e2ece7;border-radius:14px}.advanced-route-roadmap span{color:#718078;font-size:12px;line-height:1.45}@media(max-width:900px){.recurring-reference-controls,.advanced-route-roadmap{grid-template-columns:1fr}.advanced-week-grid{grid-template-columns:repeat(4,1fr)}.recurring-reference-action{align-items:stretch;flex-direction:column}.recurring-reference-action .btn{width:100%}}@media(max-width:520px){.recurring-reference-stats{grid-template-columns:1fr}.advanced-week-grid{grid-template-columns:repeat(2,1fr)}}
    `}</style>
  </section>;
}
