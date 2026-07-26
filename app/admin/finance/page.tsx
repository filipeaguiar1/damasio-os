"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  DAMASIO_SYNC_EVENT,
  getExpenses,
  getInvoices,
  getLeads,
  type Invoice,
  type Lead,
} from "@/lib/storage";

type Tab = "overview" | "invoices" | "holds" | "payouts";

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function Finance() {
  const [tab, setTab] = useState<Tab>("overview");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState(getExpenses());

  function refresh() {
    setLeads(getLeads());
    setInvoices(getInvoices());
    setExpenses(getExpenses());
  }

  useEffect(() => {
    refresh();
    const onSync = () => refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
    window.addEventListener("storage", onSync);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
      window.removeEventListener("storage", onSync);
      window.clearInterval(timer);
    };
  }, []);

  const data = useMemo(() => {
    const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
    const pendingInvoices = invoices.filter((invoice) => ["waiting_payment", "processing", "overdue", "sent"].includes(invoice.status));
    const failedInvoices = invoices.filter((invoice) => invoice.status === "failed");
    const paidLeadIds = new Set(paidInvoices.map((invoice) => invoice.leadId).filter(Boolean));
    const completedWithoutInvoice = leads.filter((lead) => lead.status === "completed" && !paidLeadIds.has(lead.id));
    const revenue = paidInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const pending = pendingInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const estimatedPlatformMargin = Math.max(0, revenue * 0.12);
    return {
      paidInvoices,
      pendingInvoices,
      failedInvoices,
      completedWithoutInvoice,
      revenue,
      pending,
      expenseTotal,
      estimatedPlatformMargin,
      net: revenue - expenseTotal - estimatedPlatformMargin,
    };
  }, [expenses, invoices, leads]);

  return (
    <AdminShell active="Payments">
      <div className="app-top">
        <div>
          <span className="eyebrow">Company financial operations</span>
          <h1>Payments</h1>
          <p className="section-intro">Invoices, customer collections, service holds, company payouts, and payment history in one place.</p>
        </div>
        <div className="row">
          <button className="btn btn-outline" type="button" onClick={refresh}>Refresh</button>
          <Link className="btn btn-primary" href="/admin/invoices">Open invoices</Link>
        </div>
      </div>

      <section className="business-metrics">
        <div className="business-metric"><span>Collected</span><strong>{money(data.revenue)}</strong><small>confirmed customer payments</small></div>
        <div className="business-metric warn"><span>Pending</span><strong>{money(data.pending)}</strong><small>waiting or processing</small></div>
        <div className="business-metric"><span>Payment issues</span><strong>{data.failedInvoices.length}</strong><small>private company customers only</small></div>
        <div className="business-metric"><span>Net estimate</span><strong>{money(data.net)}</strong><small>after expenses and platform margin</small></div>
      </section>

      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {(["overview", "invoices", "holds", "payouts"] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? "btn btn-primary" : "btn btn-outline"} onClick={() => setTab(item)}>{label(item)}</button>
        ))}
      </div>

      {tab === "overview" && <div className="grid-2">
        <section className="card table-card">
          <div className="table-head"><div><h2>Payment queue</h2><p className="section-intro">Current customer collections requiring attention.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Total</th><th>Status</th></tr></thead><tbody>
            {data.pendingInvoices.length === 0 ? <tr><td colSpan={4}>No pending payments.</td></tr> : data.pendingInvoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.customer}</strong><br/><small>{invoice.number}</small></td><td>{invoice.service}</td><td>{money(invoice.total)}</td><td><span className="pill">{label(invoice.status)}</span></td></tr>)}
          </tbody></table></div>
        </section>
        <section className="card table-card">
          <div className="table-head"><div><h2>Financial protection</h2><p className="section-intro">Canonical rules for customer charges and company payouts.</p></div></div>
          <div className="stack">
            <div className="visit-row"><span className="dot booked"></span><div><strong>Visit review window</strong><p>Customer charge waits for feedback or an open Task.</p></div><span className="pill">48h default</span></div>
            <div className="visit-row"><span className="dot upcoming"></span><div><strong>Task hold</strong><p>Provider payout stays blocked until the Task is resolved and the new review window closes.</p></div><span className="pill">Protected</span></div>
            <div className="visit-row"><span className="dot booked"></span><div><strong>Separate charge and transfer</strong><p>Customer collection and company payout remain independent.</p></div><span className="pill">Canonical</span></div>
          </div>
        </section>
      </div>}

      {tab === "invoices" && <section className="card table-card">
        <div className="table-head"><div><h2>Invoices</h2><p className="section-intro">All company invoices remain inside Payments.</p></div><Link className="btn btn-primary" href="/admin/invoices">Manage invoices</Link></div>
        <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Service</th><th>Total</th><th>Status</th></tr></thead><tbody>
          {invoices.length === 0 ? <tr><td colSpan={5}>No invoices yet.</td></tr> : invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{invoice.customer}</td><td>{invoice.service}</td><td>{money(invoice.total)}</td><td><span className="pill">{label(invoice.status)}</span></td></tr>)}
        </tbody></table></div>
      </section>}

      {tab === "holds" && <section className="card table-card">
        <div className="table-head"><div><h2>Service holds</h2><p className="section-intro">Visits completed without a final payment record or with an operational review still pending.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Total</th><th>Reason</th></tr></thead><tbody>
          {data.completedWithoutInvoice.length === 0 ? <tr><td colSpan={4}>No operational holds in the current local dataset.</td></tr> : data.completedWithoutInvoice.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><br/><small>{lead.address}</small></td><td>{lead.service}</td><td>{money(lead.total)}</td><td><span className="pill">Awaiting billing event</span></td></tr>)}
        </tbody></table></div>
      </section>}

      {tab === "payouts" && <div className="grid-2">
        <section className="card table-card"><div className="table-head"><div><h2>Company payouts</h2><p className="section-intro">Fixed payout for Master-originated customers and percentage fee for company-owned customers.</p></div></div><div className="stack"><div className="visit-row"><span className="dot booked"></span><div><strong>Fixed provider payout</strong><p>The accepted offer stores the exact amount owed to the company.</p></div><span className="pill">Master client</span></div><div className="visit-row"><span className="dot upcoming"></span><div><strong>Percentage platform fee</strong><p>Private company clients use the configured platform fee.</p></div><span className="pill">Company client</span></div></div></section>
        <section className="card table-card"><div className="table-head"><div><h2>Financial snapshot</h2><p className="section-intro">Current estimates from the connected records.</p></div></div><div className="stack"><div className="visit-row"><span className="dot booked"></span><div><strong>Platform margin estimate</strong><p>{money(data.estimatedPlatformMargin)}</p></div><span className="pill">12% legacy estimate</span></div><div className="visit-row"><span className="dot booked"></span><div><strong>Operating expenses</strong><p>{money(data.expenseTotal)}</p></div><span className="pill">Tracked</span></div></div></section>
      </div>}
    </AdminShell>
  );
}
