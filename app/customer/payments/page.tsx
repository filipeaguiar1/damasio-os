"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { CustomerServiceVisitModal } from "@/components/customer/CustomerServiceVisitModal";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import {
  getCustomerPaymentPreferences,
  saveCustomerPaymentPreferences,
  type CustomerPaymentMethod,
} from "@/lib/repositories/customerPaymentPreferenceRepository";
import { CustomerPaymentsVisitsPortal, getCustomerPaymentsVisitsPortal, type CustomerPortalBoard, type CustomerPortalVisit, type PaymentsVisit } from "@/lib/repositories/customerPortalRepository";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { getPropertyPhotoHistory, type PropertyPhotoHistory } from "@/lib/services/propertyPhotoService";

type Tab = "upcoming" | "history" | "invoices" | "payments";

const depositOptions = [10, 25, 50, 100, 250];
const PAGE_SIZE = 10;
const emptyPortal: CustomerPaymentsVisitsPortal = { upcomingVisits: [], visitHistory: [], agreements: [], billingCycles: [], billingEvents: [], openTasks: [] };
const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}
function niceDate(value?: string | null) {
  if (!value) return "To be scheduled";
  return new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
function statusLabel(status: string) { return status.replaceAll("_", " "); }
function eventState(portal: CustomerPaymentsVisitsPortal, visitId: string) { return portal.billingEvents.find((item) => item.visitId === visitId)?.state || "not_started"; }
function asCustomerVisit(visit: PaymentsVisit): CustomerPortalVisit {
  return {
    id: visit.id,
    serviceName: visit.serviceName,
    status: visit.status,
    scheduledDate: visit.scheduledDate,
    crewName: visit.crewName || null,
    address: visit.address,
    propertyId: null,
    customerVisibleSummary: visit.customerVisibleSummary || null,
    employeeNotes: null,
    durationSeconds: null,
    startedAt: null,
    finishedAt: visit.finishedAt || null,
    createdAt: visit.scheduledDate || new Date().toISOString(),
  };
}
function pageCount(total: number) { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }
function paginate<T>(items: T[], page: number) { return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE); }
function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return <nav className="portal-pagination" aria-label="Payments pagination">
    <button type="button" disabled={page === 1} onClick={() => onPage(Math.max(1, page - 1))}>Previous</button>
    {Array.from({ length: pages }, (_, index) => index + 1).map((item) => <button type="button" key={item} className={page === item ? "active" : ""} onClick={() => onPage(item)}>{item}</button>)}
    <button type="button" disabled={page === pages} onClick={() => onPage(Math.min(pages, page + 1))}>Next</button>
  </nav>;
}

export default function CustomerPayments() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [portal, setPortal] = useState<CustomerPaymentsVisitsPortal>(emptyPortal);
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [photoHistory, setPhotoHistory] = useState<PropertyPhotoHistory | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [portalLoading, setPortalLoading] = useState(true);
  const [portalError, setPortalError] = useState("");
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [servicePaymentMethod, setServicePaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [tipPaymentMethod, setTipPaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [preferenceLoading, setPreferenceLoading] = useState(true);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [invoicePage, setInvoicePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();

  const customValue = Number(customAmount);
  const validCustom = Number.isInteger(customValue) && customValue >= 5 && customValue <= 1000;
  const depositAmount = validCustom ? customValue : selectedAmount;

  async function loadPortal() {
    setPortalLoading(true);
    setPortalError("");
    try {
      const [paymentsPortal, customerBoard] = await Promise.all([getCustomerPaymentsVisitsPortal(), loadCustomerPortal()]);
      setPortal(paymentsPortal);
      setBoard(customerBoard);
    }
    catch (error) { setPortalError(error instanceof Error ? error.message : "Unable to load Payments & Visits."); }
    finally { setPortalLoading(false); }
  }

  async function loadPreferences() {
    setPreferenceLoading(true);
    try {
      const result = await getCustomerPaymentPreferences();
      setServicePaymentMethod(result.servicePaymentMethod);
      setTipPaymentMethod(result.tipPaymentMethod);
    } catch (error) {
      setPreferenceMessage(error instanceof Error ? error.message : "Payment preferences could not be loaded.");
    } finally {
      setPreferenceLoading(false);
    }
  }

  async function savePreferences() {
    setPreferenceSaving(true);
    setPreferenceMessage("");
    try {
      const result = await saveCustomerPaymentPreferences({ servicePaymentMethod, tipPaymentMethod });
      setPreferenceMessage(result.syncStatus === "local" ? "Payment preferences saved on this device. Live sync will complete when billing is connected." : "Payment preferences saved.");
    } catch (error) {
      setPreferenceMessage(error instanceof Error ? error.message : "Payment preferences could not be saved.");
    } finally {
      setPreferenceSaving(false);
    }
  }

  function chooseAmount(amount: number) { setSelectedAmount(amount); setCustomAmount(""); }
  function deposit() {
    if (!Number.isInteger(depositAmount) || depositAmount < 5 || depositAmount > 1000) return;
    void wallet.topUp(depositAmount);
  }

  useEffect(() => {
    void loadPortal();
    void loadPreferences();
    const timer = window.setInterval(() => void loadPortal(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const propertyId = board.property?.propertyId;
    if (!propertyId) return;
    void getPropertyPhotoHistory(propertyId).then(setPhotoHistory).catch(() => setPhotoHistory(null));
  }, [board.property?.propertyId]);

  const activeAgreement = useMemo(() => portal.agreements.find((item) => item.active) || portal.agreements[0], [portal.agreements]);
  const nextVisit = portal.upcomingVisits[0];
  const activeHoldCount = portal.billingEvents.filter((item) => item.state === "task_hold" || item.state === "awaiting_feedback").length;
  const operationalStatus = nextVisit ? "Schedule active" : activeAgreement?.active ? "Contract active" : "Not scheduled";
  const operationalDetail = activeAgreement
    ? `${niceDate(activeAgreement.contractStartsOn)} – ${niceDate(activeAgreement.contractEndsOn)}`
    : nextVisit ? "A visit exists, but the new billing agreement has not been created yet" : "No active schedule or billing agreement";
  const visibleMessage = portalError || billing.message || wallet.message || preferenceMessage;
  const visibleUpcoming = paginate(portal.upcomingVisits, Math.min(upcomingPage, pageCount(portal.upcomingVisits.length)));
  const visibleHistory = paginate(portal.visitHistory, Math.min(historyPage, pageCount(portal.visitHistory.length)));
  const visibleInvoices = paginate(billing.invoices, Math.min(invoicePage, pageCount(billing.invoices.length)));
  const visibleTransactions = paginate(wallet.transactions, Math.min(paymentPage, pageCount(wallet.transactions.length)));

  useEffect(() => { setUpcomingPage((page) => Math.min(page, pageCount(portal.upcomingVisits.length))); }, [portal.upcomingVisits.length]);
  useEffect(() => { setHistoryPage((page) => Math.min(page, pageCount(portal.visitHistory.length))); }, [portal.visitHistory.length]);
  useEffect(() => { setInvoicePage((page) => Math.min(page, pageCount(billing.invoices.length))); }, [billing.invoices.length]);
  useEffect(() => { setPaymentPage((page) => Math.min(page, pageCount(wallet.transactions.length))); }, [wallet.transactions.length]);
  const selectedPaymentVisit = portal.visitHistory.find((visit) => visit.id === selectedVisitId) || null;
  const selectedBoardVisit = board.visits.find((visit) => visit.id === selectedVisitId) || null;
  const selectedVisit = selectedBoardVisit || (selectedPaymentVisit ? asCustomerVisit(selectedPaymentVisit) : null);
  const selectedPhotoVisit = photoHistory?.visits.find((visit) => visit.id === selectedVisitId) || null;
  const selectedFeedback = board.feedback.find((feedback) => feedback.visitId === selectedVisitId) || null;

  return <PortalShell type="Customer" active="Payments">
    <div className="pv-hero"><div><span>Customer service centre</span><h1>Payments &amp; Visits</h1><p>Upcoming services, visit history, invoices, account balance, and payment activity in one secure place.</p></div><div className="pv-hero-badge"><i>✓</i><span><strong>Protected billing</strong><small>Stripe-secured payments and review windows</small></span></div></div>
    {visibleMessage && <div className="billing-message">{visibleMessage}</div>}

    <section className="pv-summary">
      <article><span>Account balance</span><strong>{wallet.loading ? "…" : money(wallet.balanceCredits)}</strong><small>Available for services and optional tips</small></article>
      <article><span>Next estimated visit</span><strong>{nextVisit ? niceDate(nextVisit.scheduledDate) : "No visit scheduled"}</strong><small>{nextVisit?.serviceName || "Future dates appear when scheduled"}</small></article>
      <article><span>Service status</span><strong>{operationalStatus}</strong><small>{operationalDetail}</small></article>
      <article><span>Review protection</span><strong>{activeHoldCount ? `${activeHoldCount} protected` : "Clear"}</strong><small>Open feedback windows or service Tasks</small></article>
    </section>

    <div className="pv-layout"><main className="pv-main">
      <nav className="pv-tabs" aria-label="Payments and visits sections">
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>Upcoming</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Visit History</button>
        <button className={tab === "invoices" ? "active" : ""} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={tab === "payments" ? "active" : ""} onClick={() => setTab("payments")}>Account &amp; Payments</button>
      </nav>

      {tab === "upcoming" && <section className="pv-panel"><header><div><span>Estimated schedule</span><h2>Upcoming visits</h2><p>Dates can change because of rain, extreme heat, storms, or operational conditions.</p></div><button className="billing-refresh" onClick={() => void loadPortal()} disabled={portalLoading}>{portalLoading ? "Syncing..." : "Refresh"}</button></header>{portalLoading ? <div className="billing-empty"><i>…</i><strong>Loading schedule</strong><p>Synchronising your contract and visits.</p></div> : portal.upcomingVisits.length === 0 ? <div className="billing-empty"><i>○</i><strong>No upcoming visit yet</strong><p>Your next estimated service date will appear here.</p></div> : <><div className="pv-list">{visibleUpcoming.map((visit, index) => <article key={visit.id}><div className="pv-date"><b>{new Date(`${visit.scheduledDate}T12:00:00`).toLocaleDateString("en-CA", { day: "2-digit" })}</b><span>{new Date(`${visit.scheduledDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short" })}</span></div><div><strong>{visit.serviceName}</strong><span>{visit.address || "Property address"}{visit.crewName ? ` · ${visit.crewName}` : ""}</span></div><em>{upcomingPage === 1 && index === 0 ? "Next" : "Estimated"}</em></article>)}</div><Pagination page={Math.min(upcomingPage, pageCount(portal.upcomingVisits.length))} total={portal.upcomingVisits.length} onPage={setUpcomingPage} /></>}</section>}

      {tab === "history" && <section className="pv-panel"><header><div><span>Completed services</span><h2>Visit history</h2><p>Every visit stays connected to feedback, Tasks, invoices, and payment records.</p></div></header>{portal.visitHistory.length === 0 ? <div className="billing-empty"><i>↶</i><strong>No visit history</strong><p>Completed services will appear here.</p></div> : <><div className="pv-list">{visibleHistory.map((visit) => { const state = eventState(portal, visit.id); return <button type="button" className="pv-history-button" key={visit.id} onClick={() => setSelectedVisitId(visit.id)}><div className="pv-visit-icon">✓</div><div><strong>{visit.serviceName}</strong><span>{niceDate(visit.scheduledDate)} · {visit.address || "Property"}</span><small>{visit.feedbackRating ? `${visit.feedbackRating} star feedback` : statusLabel(state)}</small></div><em className={state === "task_hold" ? "hold" : ""}>{state === "task_hold" ? "On hold" : "Open details"}</em></button>; })}</div><Pagination page={Math.min(historyPage, pageCount(portal.visitHistory.length))} total={portal.visitHistory.length} onPage={setHistoryPage} /></>}</section>}

      {tab === "invoices" && <section className="pv-panel"><header><div><span>Billing documents</span><h2>Invoices</h2><p>Only real invoices show amounts. Future estimated visits never display projected prices.</p></div><button className="billing-refresh" onClick={() => void billing.reload()} disabled={billing.loading}>{billing.loading ? "Loading..." : "Refresh"}</button></header>{billing.loading ? <div className="billing-empty"><i>…</i><strong>Loading invoices</strong><p>Checking connected billing records.</p></div> : billing.invoices.length === 0 ? <div className="billing-empty"><i>✓</i><strong>No invoices due</strong><p>Your account is currently up to date.</p></div> : <><div className="billing-invoice-list">{visibleInvoices.map((invoice) => { const paid = invoice.status === "paid"; return <article key={invoice.id} className={paid ? "paid" : ""}><div className="billing-invoice-icon">{paid ? "✓" : "$"}</div><div className="billing-invoice-copy"><span>{invoice.number}</span><strong>{invoice.service}</strong><small>{niceDate(invoice.createdAt)} · {statusLabel(invoice.status)}</small></div><div className="billing-invoice-total"><strong>{money(invoice.total)}</strong>{paid ? <span>Paid</span> : <button className="btn btn-primary" disabled={billing.payingId === invoice.id || billing.source !== "live"} onClick={() => void billing.checkout(invoice.id)}>{billing.payingId === invoice.id ? "Opening..." : "Pay invoice"}</button>}</div></article>; })}</div><Pagination page={Math.min(invoicePage, pageCount(billing.invoices.length))} total={billing.invoices.length} onPage={setInvoicePage} /></>}</section>}

      {tab === "payments" && <>
        <section className="pv-panel"><header><div><span>Payment preferences</span><h2>Choose how you pay</h2><p>Use your account balance or your saved card for services and tips. The same preference is used by web and mobile.</p></div><button className="billing-refresh" onClick={() => void loadPreferences()} disabled={preferenceLoading}>{preferenceLoading ? "Loading..." : "Refresh"}</button></header>
          <div className="billing-invoice-list">
            <article><div className="billing-invoice-icon">$</div><div className="billing-invoice-copy"><span>Services</span><strong>Service payment method</strong><small>Used for invoices and automatic service charges.</small></div><div className="billing-invoice-total payment-preference-control"><select value={servicePaymentMethod} onChange={(event) => setServicePaymentMethod(event.target.value as CustomerPaymentMethod)} disabled={preferenceLoading || preferenceSaving}><option value="card">Credit or debit card</option><option value="account_balance">Account balance</option></select></div></article>
            <article><div className="billing-invoice-icon">♥</div><div className="billing-invoice-copy"><span>Tips</span><strong>Tip payment method</strong><small>Used whenever you add an optional worker tip.</small></div><div className="billing-invoice-total payment-preference-control"><select value={tipPaymentMethod} onChange={(event) => setTipPaymentMethod(event.target.value as CustomerPaymentMethod)} disabled={preferenceLoading || preferenceSaving}><option value="card">Credit or debit card</option><option value="account_balance">Account balance</option></select></div></article>
          </div>
          <div className="payment-preference-actions"><button className="btn btn-primary" type="button" disabled={preferenceLoading || preferenceSaving} onClick={() => void savePreferences()}>{preferenceSaving ? "Saving..." : "Save payment preferences"}</button></div>
        </section>

        <section className="pv-panel" style={{ marginTop: 16 }}><header><div><span>Account balance</span><h2>Add credits</h2><p>Add real Canadian-dollar account credit securely through Stripe.</p></div><button className="billing-refresh" onClick={() => void wallet.reload()} disabled={wallet.loading}>{wallet.loading ? "Loading..." : "Refresh balance"}</button></header><div className="billing-invoice-list"><article className="wallet-topup-row"><div className="billing-invoice-icon">$</div><div className="billing-invoice-copy"><span>Deposit amount</span><strong>{money(depositAmount || 0)}</strong><small>Minimum $5 CAD · Maximum $1,000 CAD</small></div><div className="billing-invoice-total wallet-topup-control"><div className="wallet-quick-amounts">{depositOptions.map((amount) => <button key={amount} className={selectedAmount === amount && !customAmount ? "btn btn-primary" : "btn btn-outline"} type="button" disabled={wallet.openingCredits > 0} onClick={() => chooseAmount(amount)}>{money(amount)}</button>)}</div><div className="wallet-custom-amount"><input aria-label="Custom deposit amount" type="number" min={5} max={1000} step={1} placeholder="Custom CAD" value={customAmount} onChange={(event) => { setCustomAmount(event.target.value); setSelectedAmount(0); }} /><small>{customAmount && !validCustom ? "Enter $5–$1,000" : "Whole CAD amount"}</small></div><button className="btn btn-primary" type="button" disabled={wallet.openingCredits > 0 || depositAmount < 5 || depositAmount > 1000} onClick={deposit}>{wallet.openingCredits > 0 ? "Opening Stripe..." : `Add ${money(depositAmount || 0)}`}</button></div></article></div></section>

        <section className="pv-panel" style={{ marginTop: 16 }}><header><div><span>Account activity</span><h2>Payment history</h2><p>Deposits, service payments, tips, refunds, and adjustments are recorded here.</p></div></header>{wallet.transactions.length === 0 ? <div className="billing-empty"><i>≡</i><strong>No transactions yet</strong><p>Your financial activity will appear here.</p></div> : <><div className="billing-invoice-list">{visibleTransactions.map((item) => <article key={item.id}><div className="billing-invoice-icon">{item.credits >= 0 ? "+" : "−"}</div><div className="billing-invoice-copy"><span>{statusLabel(item.type)}</span><strong>{item.description || "Account transaction"}</strong><small>{new Date(item.createdAt).toLocaleString("en-CA")}</small></div><div className="billing-invoice-total"><strong>{item.credits >= 0 ? "+" : ""}{money(item.credits)}</strong><span>Balance {money(item.balanceAfterCredits)}</span></div></article>)}</div><Pagination page={Math.min(paymentPage, pageCount(wallet.transactions.length))} total={wallet.transactions.length} onPage={setPaymentPage} /></>}</section>
      </>}
    </main><aside className="pv-side"><section className="pv-contract-card"><span>Service agreement</span><h2>{activeAgreement?.serviceName || (nextVisit ? "Operational visit scheduled" : "No active plan")}</h2>{activeAgreement ? <dl><div><dt>Frequency</dt><dd>{statusLabel(activeAgreement.serviceFrequency)}</dd></div><div><dt>Billing</dt><dd>{statusLabel(activeAgreement.billingModel)}</dd></div><div><dt>Collection</dt><dd>{statusLabel(activeAgreement.collectionTiming)}</dd></div><div><dt>Review window</dt><dd>{activeAgreement.feedbackWindowHours} hours</dd></div></dl> : nextVisit ? <p>This customer has an operational visit, but no record exists yet in the new billing agreements table.</p> : <p>Your accepted service agreement will appear here.</p>}<small>Estimated future dates do not include projected charges.</small></section><section className="pv-protection-card"><i>◷</i><div><strong>Service review protection</strong><p>After a visit, you can review the work or open a Task. Billing and provider payout follow the agreement rules.</p></div></section><Link className="pv-help-link" href="/customer/requests"><span><strong>Need help with a visit?</strong><small>Open a service request or Task.</small></span><b>›</b></Link></aside></div>
    {selectedVisit && <CustomerServiceVisitModal visit={selectedVisit} property={board.property} photoVisit={selectedPhotoVisit} profilePhotoUrl={photoHistory?.profilePhotoUrl} feedback={selectedFeedback} onClose={() => setSelectedVisitId("")}/>} 
  </PortalShell>;
}
