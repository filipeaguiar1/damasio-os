"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  calculateOperationalSimulation,
  defaultOperationalSimulationInput,
  type OperationalSimulationInput,
  type OperationalSimulationResult,
} from "@/lib/simulator/operationalSimulator";

type Credential = { name: string; email: string; password: string };
type ApiStatus = {
  exists: boolean;
  customerCount: number;
  workers: Array<{ id: string; full_name: string; email: string }>;
  completedVisits: number;
  scheduledVisits: number;
  photos: number;
  paidInvoices: number;
  collected: number;
};
type ExceptionStatus = {
  exists: boolean;
  weatherRescheduledVisits: number;
  lateVisits: number;
  lowRatings: number;
  openTasks: number;
  returnRequests: number;
};
type CreateResponse = {
  message: string;
  result: OperationalSimulationResult;
  operational: {
    simulationStart: string;
    simulationEnd: string;
    liveDate: string;
    customerCount: number;
    workerCount: number;
    completedVisits: number;
    scheduledVisits: number;
    photoCount: number;
    invoiceCount: number;
    paymentCount: number;
    feedbackCount: number;
    taskCount: number;
  };
  workers: Credential[];
  featuredCustomer: Credential;
};

function cad(value: number) {
  return value.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function OperationalSimulatorPage() {
  const [input, setInput] = useState<OperationalSimulationInput>(defaultOperationalSimulationInput);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => calculateOperationalSimulation(input), [input]);

  async function token() {
    const supabase = getSupabaseBrowserClient() as any;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token as string | undefined;
  }

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const access = await token();
      if (!access) {
        setStatus(null);
        setExceptions(null);
        return;
      }
      const headers = { authorization: `Bearer ${access}` };
      const [coreResponse, exceptionResponse] = await Promise.all([
        fetch("/api/admin/operational-simulator", { headers, cache: "no-store" }),
        fetch("/api/admin/operational-simulator/exceptions", { headers, cache: "no-store" }),
      ]);
      const coreResult = await coreResponse.json();
      const exceptionResult = await exceptionResponse.json();
      if (!coreResponse.ok) throw new Error(coreResult.error || "Simulation status could not be loaded.");
      if (!exceptionResponse.ok) throw new Error(exceptionResult.error || "Exception status could not be loaded.");
      setStatus(coreResult.status);
      setExceptions(exceptionResult.status);
    } catch (error) {
      setStatus(null);
      setExceptions(null);
      setMessage(error instanceof Error ? error.message : "Simulation status could not be loaded.");
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, []);

  function change<K extends keyof OperationalSimulationInput>(key: K, value: string) {
    setInput(current => ({ ...current, [key]: Number(value) }));
  }

  async function run(action: "create" | "remove") {
    if (statusLoading) return;
    if (action === "remove" && !window.confirm("Remove only the operational simulation records and temporary accounts?")) return;
    setBusy(true);
    setMessage("");
    try {
      const access = await token();
      if (!access) throw new Error("Your Admin session expired. Sign in again.");
      const response = await fetch("/api/admin/operational-simulator", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
        body: JSON.stringify({ action, assumptions: input }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operational simulation failed.");
      setMessage(result.message || "Simulation updated.");
      setCreated(action === "create" ? result : null);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operational simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runExceptions() {
    setBusy(true);
    setMessage("");
    try {
      const access = await token();
      if (!access) throw new Error("Your Admin session expired. Sign in again.");
      const response = await fetch("/api/admin/operational-simulator/exceptions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
        body: JSON.stringify({ action: "seed" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Exception simulation failed.");
      setMessage(result.message || "Exception week seeded.");
      setExceptions(result.status);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exception simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  const exceptionSeeded = Boolean((exceptions?.weatherRescheduledVisits || 0) + (exceptions?.lateVisits || 0));

  return (
    <AdminShell active="Performance">
      <div className="app-top">
        <div>
          <span className="eyebrow">Admin Only · Canonical Supabase</span>
          <h1>Financial & Operational Simulator</h1>
          <p className="section-intro">Create two months of linked Customer → Property → Quote → Job → Route → Visit → Photo → Paid Invoice → Feedback → Task data.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/performance" className="btn btn-outline">Back to Reports</Link>
          <button type="button" className="btn btn-primary" disabled={busy || statusLoading || Boolean(status?.exists)} onClick={() => void run("create")}>{busy ? "Working…" : statusLoading ? "Checking…" : "Create 2-Month Simulation"}</button>
          <button type="button" className="btn btn-outline" disabled={busy || statusLoading || !status?.exists || exceptionSeeded} onClick={() => void runExceptions()}>{exceptionSeeded ? "Exception Week Created" : "Run Exception Week"}</button>
          <button type="button" className="btn btn-outline" disabled={busy || statusLoading || !status?.exists} onClick={() => void run("remove")}>Remove Simulation</button>
        </div>
      </div>

      {message && <div className="payment-message" role="status" style={{ marginTop: 16 }}>{message}</div>}

      <section className="business-metrics" style={{ marginTop: 20 }}>
        <div className="business-metric"><span>Customers</span><strong>{status?.customerCount ?? input.customerCount}</strong><small>{input.customerCount / input.employeeCount} homes per worker</small></div>
        <div className="business-metric"><span>Completed Visits</span><strong>{status?.completedVisits ?? preview.visits}</strong><small>{status && status.completedVisits > preview.visits ? `${preview.visits} historical + ${status.completedVisits - preview.visits} live` : `${input.weeks} completed weeks`}</small></div>
        <div className="business-metric"><span>Paid Invoices</span><strong>{cad(status?.collected ?? preview.customerTotal)}</strong><small>includes HST; no real Stripe activity</small></div>
        <div className="business-metric"><span>Adjusted Profit</span><strong>{cad(preview.adjustedOperatingProfit)}</strong><small>{percent(preview.adjustedOperatingMarginRate)} after modeled exceptions</small></div>
      </section>

      {status?.exists && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="table-head"><div><h2>Live Simulation Status</h2><p className="section-intro">These records exist in the company’s canonical Supabase tables.</p></div><Link href="/admin/routes?tab=view" className="btn btn-primary">Open Routes</Link></div>
          <div className="form-grid">
            <div className="field"><label>Workers</label><strong className="input">{status.workers.length}</strong></div>
            <div className="field"><label>Today’s scheduled visits</label><strong className="input">{status.scheduledVisits}</strong></div>
            <div className="field"><label>Employee photos</label><strong className="input">{status.photos}</strong></div>
            <div className="field"><label>Paid invoices</label><strong className="input">{status.paidInvoices}</strong></div>
          </div>
        </section>
      )}

      {status?.exists && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="table-head"><div><h2>Live Exception Status</h2><p className="section-intro">Rain and delay are seeded by Admin. Low rating, follow-up Task and Return Visit are created through the Customer flow.</p></div></div>
          <div className="form-grid">
            <div className="field"><label>Rain-rescheduled visits</label><strong className="input">{exceptions?.weatherRescheduledVisits ?? 0}</strong></div>
            <div className="field"><label>Late arrivals</label><strong className="input">{exceptions?.lateVisits ?? 0}</strong></div>
            <div className="field"><label>Low ratings</label><strong className="input">{exceptions?.lowRatings ?? 0}</strong></div>
            <div className="field"><label>Open follow-up tasks</label><strong className="input">{exceptions?.openTasks ?? 0}</strong></div>
            <div className="field"><label>Return requests</label><strong className="input">{exceptions?.returnRequests ?? 0}</strong></div>
          </div>
        </section>
      )}

      <div className="ops-grid" style={{ marginTop: 20 }}>
        <section className="card ops-panel">
          <h2>Volume & Capacity</h2>
          <div className="form-grid">
            <div className="field"><label>Weekly houses</label><input className="input" type="number" min={25} max={60} value={input.customerCount} onChange={event => change("customerCount", event.target.value)} /></div>
            <div className="field"><label>Workers</label><input className="input" type="number" min={1} max={4} value={input.employeeCount} onChange={event => change("employeeCount", event.target.value)} /></div>
            <div className="field"><label>Weeks</label><input className="input" type="number" min={1} max={32} value={input.weeks} onChange={event => change("weeks", event.target.value)} /></div>
            <div className="field"><label>Company capacity/day</label><input className="input" type="number" min={1} max={40} value={input.dailyCompanyCapacity} onChange={event => change("dailyCompanyCapacity", event.target.value)} /></div>
            <div className="field"><label>Max homes/worker/week</label><input className="input" type="number" min={1} max={60} value={input.maxHomesPerEmployee} onChange={event => change("maxHomesPerEmployee", event.target.value)} /></div>
            <div className="field"><label>Work days/week</label><input className="input" type="number" min={1} max={7} value={input.workDaysPerWeek} onChange={event => change("workDaysPerWeek", event.target.value)} /></div>
          </div>
          <p className="section-intro" style={{ marginTop: 12 }}>Capacity: <strong>{preview.capacityStatus.replaceAll("_", " ")}</strong> · {percent(preview.capacityUtilizationRate)} company utilization · {percent(preview.employeeCapacityUtilizationRate)} employee utilization.</p>
        </section>

        <section className="card ops-panel">
          <h2>Time & Pricing</h2>
          <div className="form-grid">
            <div className="field"><label>Price per weekly cut</label><input className="input" type="number" min={1} value={input.weeklyPrice} onChange={event => change("weeklyPrice", event.target.value)} /></div>
            <div className="field"><label>Hourly wage</label><input className="input" type="number" min={1} value={input.hourlyWage} onChange={event => change("hourlyWage", event.target.value)} /></div>
            <div className="field"><label>Travel minutes/house</label><input className="input" type="number" min={0} value={input.travelMinutesPerVisit} onChange={event => change("travelMinutesPerVisit", event.target.value)} /></div>
            <div className="field"><label>Clipping pickup share</label><input className="input" type="number" min={0} max={1} step={0.05} value={input.clippingPickupShare} onChange={event => change("clippingPickupShare", event.target.value)} /></div>
          </div>
          <p className="section-intro" style={{ marginTop: 12 }}>Average service: <strong>{preview.averageServiceMinutes.toFixed(1)} min</strong> · total with travel/clippings: <strong>{preview.averageTotalMinutes.toFixed(1)} min</strong>.</p>
        </section>
      </div>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Exception Impact Model</h2><p className="section-intro">Expected impact across the same eight-week operation; the seeded exception week supplies real workflow examples.</p></div></div>
        <div className="table-wrap"><table><tbody>
          <tr><th>Rain-rescheduled visits</th><td>{preview.weatherRescheduledVisits}</td><th>Late arrivals</th><td>{preview.lateVisits}</td></tr>
          <tr><th>Service issues</th><td>{preview.serviceIssueVisits}</td><th>Expected return visits</th><td>{preview.returnVisits}</td></tr>
          <tr><th>Exception labour</th><td>{preview.exceptionLaborHours.toFixed(2)} hours</td><th>Customer credits</th><td>{cad(preview.customerCredits)}</td></tr>
          <tr><th>Total exception cost</th><td><strong>{cad(preview.exceptionCost)}</strong></td><th>Revenue at risk</th><td>{cad(preview.revenueAtRisk)}</td></tr>
          <tr><th>Base operating profit</th><td>{cad(preview.operatingProfit)}</td><th>Adjusted operating profit</th><td><strong>{cad(preview.adjustedOperatingProfit)}</strong></td></tr>
        </tbody></table></div>
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-head"><div><h2>Two-Month Result</h2><p className="section-intro">HST stays separate from operating revenue.</p></div></div>
        <div className="table-wrap"><table><tbody>
          <tr><th>Revenue before HST</th><td>{cad(preview.subtotalRevenue)}</td><th>HST collected</th><td>{cad(preview.hst)}</td></tr>
          <tr><th>Labor cost</th><td>{cad(preview.laborCost)}</td><th>Fuel + equipment</th><td>{cad(preview.routeDirectCost)}</td></tr>
          <tr><th>Vehicle, insurance and overhead</th><td>{cad(preview.fixedCost)}</td><th>Payment processing</th><td>{cad(preview.paymentCost)}</td></tr>
          <tr><th>Total operating cost</th><td>{cad(preview.totalCost)}</td><th>Operating profit</th><td><strong>{cad(preview.operatingProfit)}</strong></td></tr>
          <tr><th>Cost per visit</th><td>{cad(preview.costPerVisit)}</td><th>Profit per visit</th><td>{cad(preview.profitPerVisit)}</td></tr>
          <tr><th>Break-even customers</th><td>{preview.breakEvenCustomers}</td><th>Revenue/productive hour</th><td>{cad(preview.revenuePerProductiveHour)}</td></tr>
        </tbody></table></div>
      </section>

      {created && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="table-head"><div><h2>Temporary Test Logins</h2><p className="section-intro">Shown once after creation. Today’s route is ready for Start → Done testing.</p></div><Link href="/login" className="btn btn-primary">Open Login</Link></div>
          <div className="settings-grid" style={{ marginTop: 12 }}>
            <div className="stack">
              {created.workers.map(worker => <div className="card" key={worker.email}><strong>{worker.name}</strong><code>{worker.email}</code><code>{worker.password}</code></div>)}
            </div>
            <div className="card"><strong>{created.featuredCustomer.name}</strong><p>Featured customer portal account</p><code>{created.featuredCustomer.email}</code><code>{created.featuredCustomer.password}</code></div>
          </div>
          <p className="section-intro" style={{ marginTop: 12 }}>{created.operational.completedVisits} completed visits, {created.operational.photoCount} employee photos and {created.operational.invoiceCount} paid invoices were created. Feedback and return visits are submitted through the Customer portal.</p>
        </section>
      )}
    </AdminShell>
  );
}
