"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import { CustomerPaymentsVisitsPortal, getCustomerPaymentsVisitsPortal } from "@/lib/repositories/customerPortalRepository";

type Tab = "upcoming" | "history" | "invoices" | "payments";

const emptyPortal: CustomerPaymentsVisitsPortal = {
  upcomingVisits: [],
  visitHistory: [],
  agreements: [],
  billingCycles: [],
  billingEvents: [],
  openTasks: [],
};

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function niceDate(value?: string | null) {
  if (!value) return "To be scheduled";
  return new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function eventState(portal: CustomerPaymentsVisitsPortal, visitId: string) {
  return portal.billingEvents.find((item) => item.visitId === visitId)?.state || "not_started";
}

export default function CustomerPayments() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [portal, setPortal] = useState<CustomerPaymentsVisitsPortal>(emptyPortal);
  const [portalLoading, setPortalLoading] = useState(true);
  const [portalError, setPortalError] = useState("");
  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();

  async function loadPortal() {
    setPortalLoading(true);
    setPortalError("");
    try {
      setPortal(await getCustomerPaymentsVisitsPortal());
    } catch (error) {
      setPortalError(error instanceof Error ? error.message : "Unable to load Payments & Visits.");
    } finally {
      setPortalLoading(false);
    }
  }

  useEffect(() => {
    void loadPortal();
    const timer = window.setInterval(() => void loadPortal(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const activeAgreement = useMemo(() => portal.agreements.find((item) => item.active) || portal.agreements[0], [portal.agreements]);
  const nextVisit = portal.upcomingVisits[0];
  const activeHoldCount = portal.billingEvents.filter((item) => item.state === "task_hold" || item.state === "awaiting_feedback").length;
  const visibleMessage = portalError || billing.message || wallet.message;

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="pv-hero">
        <div>
          <span>Customer service centre</span>
          <h1>Payments &amp; Visits</h1>
          <p>Upcoming services, visit history, invoices, and payment activity in one secure place.</p>
        </div>
        <div className="pv-hero-badge"><i>✓</i><span><strong>Protected billing</strong><small>Stripe-secured payments and review windows</small></span></div>
      </div>

      {visibleMessage && <div className="billing-message">{visibleMessage}</div>}

      <section className="pv-summary">
        <article><span>Next estimated visit</span><strong>{nextVisit ? niceDate(nextVisit.scheduledDate) : "No visit scheduled"}</strong><small>{nextVisit?.serviceName || "Future dates appear when scheduled"}</small></article>
        <article><span>Contract status</span><strong>{activeAgreement?.active ? "Active" : "Not active"}</strong><small>{activeAgreement ? `${niceDate(activeAgreement.contractStartsOn)} – ${niceDate(activeAgreement.contractEndsOn)}` : "No billing agreement yet"}</small></article>
        <article><span>Review protection</span><strong>{activeHoldCount ? `${activeHoldCount} protected` : "Clear"}</strong><small>Open feedback windows or service Tasks</small></article>
      </section>

      <div className="pv-layout">
        <main className="pv-main">
          <nav className="pv-tabs" aria-label="Payments and visits sections">
            <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>Upcoming</button>
            <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Visit History</button>
            <button className={tab === "invoices" ? "active" : ""} onClick={() => setTab("invoices")}>Invoices</button>
            <button className={tab === "payments" ? "active" : ""} onClick={() => setTab("payments")}>Payment History</button>
          </nav>

          {tab === "upcoming" && <section className="pv-panel">
            <header><div><span>Estimated schedule</span><h2>Upcoming visits</h2><p>Dates can change because of rain, extreme heat, storms, or operational conditions.</p></div><button className="billing-refresh" onClick={() => void loadPortal()} disabled={portalLoading}>{portalLoading ? "Syncing..." : "Refresh"}</button></header>
            {portalLoading ? <div className="billing-empty"><i>…</i><strong>Loading schedule</strong><p>Synchronising your contract and visits.</p></div> : portal.upcomingVisits.length === 0 ? <div className="billing-empty"><i>○</i><strong>No upcoming visit yet</strong><p>Your next estimated service date will appear here.</p></div> : <div className="pv-list">{portal.upcomingVisits.map((visit, index) => <article key={visit.id}><div className="pv-date"><b>{new Date(`${visit.scheduledDate}T12:00:00`).toLocaleDateString("en-CA", { day: "2-digit" })}</b><span>{new Date(`${visit.scheduledDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short" })}</span></div><div><strong>{visit.serviceName}</strong><span>{visit.address || "Property address"}{visit.crewName ? ` · ${visit.crewName}` : ""}</span></div><em>{index === 0 ? "Next" : "Estimated"}</em></article>)}</div>}
          </section>}

          {tab === "history" && <section className="pv-panel">
            <header><div><span>Completed services</span><h2>Visit history</h2><p>Every visit stays connected to feedback, Tasks, invoices, and payment records.</p></div></header>
            {portal.visitHistory.length === 0 ? <div className="billing-empty"><i>↶</i><strong>No visit history</strong><p>Completed services will appear here.</p></div> : <div className="pv-list">{portal.visitHistory.map((visit) => { const state = eventState(portal, visit.id); return <article key={visit.id}><div className="pv-visit-icon">✓</div><div><strong>{visit.serviceName}</strong><span>{niceDate(visit.scheduledDate)} · {visit.address || "Property"}</span><small>{visit.feedbackRating ? `${visit.feedbackRating} star feedback` : statusLabel(state)}</small></div><em className={state === "task_hold" ? "hold" : ""}>{state === "task_hold" ? "On hold" : statusLabel(visit.status)}</em></article>; })}</div>}
          </section>}

          {tab === "invoices" && <section className="pv-panel">
            <header><div><span>Billing documents</span><h2>Invoices</h2><p>Only real invoices show amounts. Future estimated visits never display projected prices.</p></div><button className="billing-refresh" onClick={() => void billing.reload()} disabled={billing.loading}>{billing.loading ? "Loading..." : "Refresh"}</button></header>
            {billing.loading ? <div className="billing-empty"><i>…</i><strong>Loading invoices</strong><p>Checking connected billing records.</p></div> : billing.invoices.length === 0 ? <div className="billing-empty"><i>✓</i><strong>No invoices due</strong><p>Your account is currently up to date.</p></div> : <div className="billing-invoice-list">{billing.invoices.map((invoice) => { const paid = invoice.status === "paid"; return <article key={invoice.id} className={paid ? "paid" : ""}><div className="billing-invoice-icon">{paid ? "✓" : "$"}</div><div className="billing-invoice-copy"><span>{invoice.number}</span><strong>{invoice.service}</strong><small>{niceDate(invoice.createdAt)} · {statusLabel(invoice.status)}</small></div><div className="billing-invoice-total"><strong>{money(invoice.total)}</strong>{paid ? <span>Paid</span> : <button className="btn btn-primary" disabled={billing.payingId === invoice.id || billing.source !== "live"} onClick={() => void billing.checkout(invoice.id)}>{billing.payingId === invoice.id ? "Opening..." : "Pay invoice"}</button>}</div></article>; })}</div>}
          </section>}

          {tab === "payments" && <section className="pv-panel">
            <header><div><span>Account activity</span><h2>Payment history</h2><p>Deposits, service payments, tips, refunds, and adjustments are recorded here.</p></div><button className="billing-refresh" onClick={() => void wallet.reload()} disabled={wallet.loading}>{wallet.loading ? "Loading..." : "Refresh"}</button></header>
            {wallet.transactions.length === 0 ? <div className="billing-empty"><i>≡</i><strong>No transactions yet</strong><p>Your financial activity will appear here.</p></div> : <div className="billing-invoice-list">{wallet.transactions.map((item) => <article key={item.id}><div className="billing-invoice-icon">{item.credits >= 0 ? "+" : "−"}</div><div className="billing-invoice-copy"><span>{statusLabel(item.type)}</span><strong>{item.description || "Account transaction"}</strong><small>{new Date(item.createdAt).toLocaleString("en-CA")}</small></div><div className="billing-invoice-total"><strong>{item.credits >= 0 ? "+" : ""}{money(item.credits)}</strong><span>Balance {money(item.balanceAfterCredits)}</span></div></article>)}</div>}
          </section>}
        </main>

        <aside className="pv-side">
          <section className="pv-contract-card">
            <span>Service agreement</span>
            <h2>{activeAgreement?.serviceName || "No active plan"}</h2>
            {activeAgreement ? <dl><div><dt>Frequency</dt><dd>{statusLabel(activeAgreement.serviceFrequency)}</dd></div><div><dt>Billing</dt><dd>{statusLabel(activeAgreement.billingModel)}</dd></div><div><dt>Collection</dt><dd>{statusLabel(activeAgreement.collectionTiming)}</dd></div><div><dt>Review window</dt><dd>{activeAgreement.feedbackWindowHours} hours</dd></div></dl> : <p>Your accepted service agreement will appear here.</p>}
            <small>Estimated future dates do not include projected charges.</small>
          </section>

          <section className="pv-protection-card">
            <i>◷</i><div><strong>Service review protection</strong><p>After a visit, you can review the work or open a Task. Billing and provider payout follow the agreement rules.</p></div>
          </section>

          <Link className="pv-help-link" href="/customer/requests"><span><strong>Need help with a visit?</strong><small>Open a service request or Task.</small></span><b>›</b></Link>
        </aside>
      </div>
    </PortalShell>
  );
}
