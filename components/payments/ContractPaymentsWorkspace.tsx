"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createPaymentRequestLink,
  createManualPaymentRequestLink,
  emptyWorkspace,
  generateAgreementVisits,
  getPaymentsWorkspace,
  saveAgreement,
  syncAgreementToStripe,
  type PaymentsWorkspace,
} from "@/lib/repositories/paymentsWorkspaceRepository";
import styles from "./ContractPaymentsWorkspace.module.css";

type Scope = "master" | "company";
type Tab = "overview" | "contracts" | "requests" | "holds" | "payouts";
type CollectionTiming = "after_visit" | "period_prepaid" | "manual";
type ServiceFrequency = "one_time" | "weekly" | "biweekly" | "monthly";

function money(cents?: number | null) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((cents || 0) / 100);
}

function label(value?: string | null) {
  return (value || "not set").replaceAll("_", " ");
}

function tabLabel(tab: Tab) {
  if (tab === "overview") return "Overview";
  if (tab === "contracts") return "Contracts";
  if (tab === "requests") return "Payment Actions";
  if (tab === "holds") return "Holds";
  return "Payout Rules";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function frequencySummary(frequency: ServiceFrequency) {
  if (frequency === "monthly") return "Monthly · one charge per billing period";
  if (frequency === "weekly") return "Weekly service · charged per completed Visit";
  if (frequency === "biweekly") return "Biweekly service · charged per completed Visit";
  return "One-time service · charged once";
}

export function ContractPaymentsWorkspace({ scope }: { scope: Scope }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [workspace, setWorkspace] = useState<PaymentsWorkspace>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [serviceFrequency, setServiceFrequency] = useState<ServiceFrequency>("weekly");
  const [collectionTiming, setCollectionTiming] = useState<CollectionTiming>("after_visit");
  const [requestingInvoiceId, setRequestingInvoiceId] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestDescription, setRequestDescription] = useState("Service payment");
  const [creatingManualRequest, setCreatingManualRequest] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const data = await getPaymentsWorkspace(scope);
      setWorkspace(data);
      if (selectedCustomerId && !data.customers.some((customer) => customer.id === selectedCustomerId)) {
        setSelectedCustomerId("");
        setSelectedJobId("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payments workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [scope]);

  const selectedCustomer = workspace.customers.find((customer) => customer.id === selectedCustomerId) || null;
  const customerJobs = workspace.jobs.filter((job) => job.customerId === selectedCustomerId);
  const selectedJob = customerJobs.find((job) => job.id === selectedJobId) || customerJobs[0] || null;
  const selectedAgreement = workspace.agreements.find((agreement) => agreement.jobId === selectedJob?.id && agreement.active) || null;
  const isPlatformCustomer = selectedCustomer?.origin === "platform";
  const canEditSelected = Boolean(selectedCustomer && (scope === "master" ? isPlatformCustomer : !isPlatformCustomer));
  const companyRestricted = scope === "company" && Boolean(isPlatformCustomer);
  const normalizedQuery = customerQuery.trim().toLowerCase();
  const filteredCustomers = workspace.customers.filter((customer) => {
    if (!normalizedQuery) return true;
    return [customer.name, customer.email, customer.origin].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  });

  useEffect(() => {
    if (!selectedCustomerId) {
      if (selectedJobId) setSelectedJobId("");
      return;
    }
    if (selectedJob && selectedJob.id !== selectedJobId) setSelectedJobId(selectedJob.id);
  }, [selectedCustomerId, selectedJob?.id]);

  useEffect(() => {
    if (companyRestricted && tab !== "overview") setTab("overview");
  }, [companyRestricted, tab]);

  useEffect(() => {
    const nextFrequency = (selectedAgreement?.serviceFrequency || "weekly") as ServiceFrequency;
    setServiceFrequency(nextFrequency);
    if (nextFrequency === "monthly") setCollectionTiming("period_prepaid");
    else if (nextFrequency === "one_time" && selectedAgreement?.collectionTiming === "manual") setCollectionTiming("manual");
    else setCollectionTiming("after_visit");
  }, [selectedAgreement?.id, selectedAgreement?.serviceFrequency, selectedAgreement?.collectionTiming]);

  const monthlyBilling = serviceFrequency === "monthly";
  const perVisitBilling = serviceFrequency === "weekly" || serviceFrequency === "biweekly";
  const visibleCustomers = selectedCustomer ? [selectedCustomer] : filteredCustomers;
  const visiblePaymentRequests = scope === "master" ? workspace.invoices.filter((invoice) => !selectedCustomerId || invoice.customerId === selectedCustomerId) : [];
  const visibleHolds = workspace.events.filter((event) =>
    ["task_hold", "awaiting_feedback", "payout_pending", "charge_failed", "payment_failed"].includes(event.state)
    && (!selectedCustomerId || event.customerId === selectedCustomerId)
  );
  const visibleAgreements = workspace.agreements.filter((agreement) => agreement.active && (!selectedCustomerId || agreement.customerId === selectedCustomerId));

  const metrics = useMemo(() => {
    const active = workspace.agreements.filter((agreement) => agreement.active);
    const holds = workspace.events.filter((event) => ["task_hold", "awaiting_feedback", "payout_pending"].includes(event.state));
    const providerPayoutCents = active.reduce((sum, agreement) => sum + Number(agreement.providerPayoutCents || 0), 0);
    const platformRevenueCents = active.reduce((sum, agreement) => {
      if (agreement.ownerRole === "master") return sum + Math.max(0, Number(agreement.customerAmountCents || 0) - Number(agreement.providerPayoutCents || 0));
      return sum + Math.round(Number(agreement.customerAmountCents || 0) * Number(agreement.platformFeeBasisPoints || 0) / 10000);
    }, 0);
    return { active: active.length, holds: holds.length, providerPayoutCents, platformRevenueCents };
  }, [workspace]);

  async function createRequestLink(invoiceId: string, openAfterCreate = false) {
    if (scope !== "master") return;
    setRequestingInvoiceId(invoiceId);
    setMessage("");
    try {
      const result = await createPaymentRequestLink(invoiceId);
      setPaymentLinks((current) => ({ ...current, [invoiceId]: result.url }));
      setMessage(result.reused ? "Existing payment link reopened for this request." : "Payment request link created.");
      await load();
      if (openAfterCreate) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment request link could not be created.");
    } finally {
      setRequestingInvoiceId("");
    }
  }

  async function createManualRequestLink(openAfterCreate = false) {
    if (scope !== "master" || !selectedCustomer) return;
    const amountCents = Math.round(Number(requestAmount || 0) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) return setMessage("Enter the payment amount before creating the link.");
    setCreatingManualRequest(true);
    setMessage("");
    try {
      const result = await createManualPaymentRequestLink({ customerId: selectedCustomer.id, amountCents, description: requestDescription || "Service payment" });
      setPaymentLinks((current) => ({ ...current, [result.invoiceId]: result.url }));
      setMessage(`Payment request ${result.invoiceNumber || ""} created.`);
      setRequestAmount("");
      await load();
      if (openAfterCreate) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment request link could not be created.");
    } finally {
      setCreatingManualRequest(false);
    }
  }

  function openRequestLink(invoiceId: string) {
    if (scope !== "master") return;
    const url = paymentLinks[invoiceId];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else void createRequestLink(invoiceId, true);
  }

  async function submitContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !selectedCustomer || !canEditSelected) return;
    const form = new FormData(event.currentTarget);
    const customerAmount = Math.round(Number(form.get("customerAmount") || 0) * 100);
    const providerPayout = Math.round(Number(form.get("providerPayout") || 0) * 100);
    const frequency = String(form.get("frequency") || serviceFrequency) as ServiceFrequency;
    const isMonthly = frequency === "monthly";
    const isPerVisit = frequency === "weekly" || frequency === "biweekly";
    const effectiveCollectionTiming: CollectionTiming = isMonthly ? "period_prepaid" : isPerVisit ? "after_visit" : collectionTiming;
    const effectiveBillingModel = isMonthly
      ? "monthly_fixed_subscription"
      : effectiveCollectionTiming === "manual"
        ? "manual"
        : scope === "master" ? "per_visit_fixed_payout" : "per_visit_percentage_fee";
    const startsOn = String(form.get("startsOn") || today());
    const endsOn = String(form.get("endsOn") || "") || null;
    const feedbackHours = Number(form.get("feedbackHours") || 24);

    if (!customerAmount || customerAmount < 0) return setMessage("Enter the customer contract amount.");
    if (scope === "master" && effectiveCollectionTiming !== "manual" && providerPayout <= 0) return setMessage("Master contracts require the exact company payout.");
    if (scope === "master" && providerPayout > customerAmount) return setMessage("Company payout cannot exceed the customer amount.");

    setSaving(true);
    setMessage("");
    try {
      const agreementId = await saveAgreement({
        jobId: selectedJob.id,
        billingModel: effectiveBillingModel,
        collectionTiming: effectiveCollectionTiming,
        serviceFrequency: frequency,
        customerAmountCents: customerAmount,
        providerPayoutCents: scope === "master" && effectiveCollectionTiming !== "manual" ? providerPayout : null,
        platformFeeBasisPoints: null,
        contractStartsOn: startsOn,
        contractEndsOn: endsOn,
        feedbackWindowHours: feedbackHours,
        prepaidPlanType: isMonthly ? "monthly" : null,
        planBillingDay: isMonthly ? Number(form.get("billingDay") || 1) : 1,
        serviceStartDay: isMonthly ? Number(form.get("serviceStartDay") || 0) || null : null,
      });
      if (effectiveCollectionTiming !== "manual") await syncAgreementToStripe(agreementId);
      const created = await generateAgreementVisits(agreementId);
      setMessage(isMonthly
        ? `Monthly plan saved and synced with Stripe. ${created} future visit${created === 1 ? "" : "s"} created; customer collection occurs once per month.`
        : isPerVisit
          ? `${frequency === "weekly" ? "Weekly" : "Biweekly"} per-Visit billing saved and synced with Stripe. ${created} future visit${created === 1 ? "" : "s"} created; each completed Visit follows feedback/Task checks before its invoice is released.`
          : `One-time contract saved${effectiveCollectionTiming === "manual" ? "" : ", synced with Stripe"}, and ${created} future visit${created === 1 ? "" : "s"} created.`);
      await load();
      setTab("overview");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Contract could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const title = scope === "master" ? "Platform Payments" : "Payments";
  const subtitle = scope === "master"
    ? "Define customer billing, platform-owned contracts, exact company earnings, and protected release rules."
    : "Manage company-owned customer contracts. Manual customer charge links are reserved for Master; company earnings are handled in Receivables.";
  const tabs: Tab[] = companyRestricted
    ? ["overview"]
    : scope === "master"
      ? ["overview", "contracts", "requests", "holds", "payouts"]
      : ["overview", "contracts", "holds", "payouts"];

  const customerPicker = (mode: "compact" | "full" = "full") => <div className={mode === "compact" ? styles.inlineCustomerPicker : styles.customerFind}>
    <label><span>Find customer</span><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Search name, email or origin" /></label>
    <label><span>Customer</span><select value={selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedJobId(""); }}><option value="">Choose customer</option>{filteredCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {label(customer.origin)}</option>)}</select></label>
  </div>;

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div><small>{scope === "master" ? "Master financial control" : "Company financial operations"}</small><h1>{title}</h1><p>{subtitle}</p></div>
      <div className={styles.heroActions}>
        {scope === "master" && <button type="button" className={`${styles.button} ${styles.heroButton}`} onClick={() => setTab("requests")}>Master Payment Action</button>}
        <div className={styles.heroBadge}><i>✓</i><div><strong>Protected billing</strong><span>Weekly/biweekly = per Visit · Monthly = per period</span></div></div>
      </div>
    </section>

    {message && <div className={styles.message}>{message}</div>}

    <section className={styles.metrics}>
      <article className={styles.metric}><span>Customers</span><strong>{workspace.customers.length}</strong><small>{scope === "master" ? "platform owned" : "served by this company"}</small></article>
      <article className={styles.metric}><span>Active contracts</span><strong>{metrics.active}</strong><small>active agreement versions</small></article>
      <article className={styles.metric}><span>Protected holds</span><strong>{metrics.holds}</strong><small>feedback or Task review</small></article>
      <article className={styles.metric}><span>{scope === "master" ? "Platform revenue" : "Company payout rules"}</span><strong>{money(scope === "master" ? metrics.platformRevenueCents : metrics.providerPayoutCents)}</strong><small>{scope === "master" ? "contract gross platform share before Stripe cost" : "actual released money lives in Receivables"}</small></article>
    </section>

    <section className={styles.customerSelector}>
      <div><span>Customer workspace</span><strong>{selectedCustomer?.name || "None"}</strong><small>Select a customer to view or configure only that account.</small></div>
      {customerPicker()}
    </section>

    <section className={styles.layout}>
      <main className={styles.main}>
        <nav className={styles.tabs}>{tabs.map((item) => <button key={item} type="button" className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>{tabLabel(item)}</button>)}</nav>

        {tab === "overview" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Live contract board</span><h2>{selectedCustomer ? "Selected customer" : "Customers and service plans"}</h2><p>{companyRestricted ? "This platform customer is operational only. Commercial terms and release rules are private to Master." : selectedCustomer ? "Showing only the selected account." : "Select a customer above or review all available accounts."}</p></div><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void load()} disabled={loading}>{loading ? "Syncing…" : "Refresh"}</button></header>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Customer</th><th>Origin</th><th>Service</th><th>Next visit</th><th>Contract</th><th>Owner</th></tr></thead><tbody>
            {visibleCustomers.length === 0 ? <tr><td colSpan={6}>No customers available in this scope.</td></tr> : visibleCustomers.map((customer) => {
              const job = workspace.jobs.find((item) => item.customerId === customer.id);
              const agreement = workspace.agreements.find((item) => item.customerId === customer.id && item.active);
              const hideCommercial = scope === "company" && customer.origin === "platform";
              return <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.email || "No email"}</small></td><td><span className={styles.pill}>{label(customer.origin)}</span></td><td>{job?.serviceName || "No active job"}</td><td>{job?.nextVisitDate || "Not generated"}</td><td>{hideCommercial ? "Managed by Master" : agreement ? `${label(agreement.serviceFrequency)} · ${label(agreement.billingModel)}` : "Needs setup"}</td><td>{customer.origin === "platform" ? "Master" : "Company"}</td></tr>;
            })}
          </tbody></table></div>
        </section>}

        {tab === "contracts" && !companyRestricted && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Contract builder</span><h2>Define service billing</h2><p>Weekly and biweekly services are billed per completed Visit. Monthly service uses one monthly invoice. One-time work is charged once.</p></div></header>
          <form className={styles.form} onSubmit={submitContract} key={`${selectedCustomerId}-${selectedAgreement?.id || "new"}`}>
            <div className={styles.embeddedPicker}><div><strong>{selectedCustomer?.name || "Choose a customer"}</strong><small>{selectedCustomer ? `${selectedCustomer.email || "No email"} · ${label(selectedCustomer.origin)}` : "Search by name or email to edit the contract faster."}</small></div>{customerPicker("compact")}</div>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.wide}`}><label>Selected customer</label><input value={selectedCustomer?.name || "None"} readOnly /></div>
              <div className={`${styles.field} ${styles.wide}`}><label>Service job</label><select value={selectedJob?.id || ""} onChange={(event) => setSelectedJobId(event.target.value)} disabled={!selectedCustomer}><option value="">None</option>{customerJobs.map((job) => <option key={job.id} value={job.id}>{job.serviceName}</option>)}</select></div>
              <div className={styles.field}><label>Service frequency</label><select name="frequency" value={serviceFrequency} onChange={(event) => { const next = event.target.value as ServiceFrequency; setServiceFrequency(next); setCollectionTiming(next === "monthly" ? "period_prepaid" : "after_visit"); }}><option value="one_time">One time</option><option value="weekly">Weekly service</option><option value="biweekly">Biweekly service</option><option value="monthly">Monthly service</option></select></div>
              <div className={styles.field}><label>Customer collection</label><input value={frequencySummary(serviceFrequency)} readOnly /></div>
              <div className={styles.field}><label>Billing model</label><input value={monthlyBilling ? "Monthly fixed subscription" : perVisitBilling ? (scope === "master" ? "Per Visit · fixed company payout" : "Per Visit · platform percentage fee") : collectionTiming === "manual" ? "Manual" : scope === "master" ? "One-time · fixed company payout" : "One-time · platform percentage fee"} readOnly /></div>
              {serviceFrequency === "one_time" && <div className={styles.field}><label>One-time collection</label><select name="collectionTiming" value={collectionTiming} onChange={(event) => setCollectionTiming(event.target.value as CollectionTiming)}><option value="after_visit">After service</option><option value="manual">Manual</option></select></div>}
              <div className={styles.field}><label>{monthlyBilling ? "Monthly customer amount (CAD)" : perVisitBilling ? "Customer amount per Visit (CAD)" : "Customer amount (CAD)"}</label><input name="customerAmount" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.customerAmountCents || 0) / 100 : ""} required /></div>
              {scope === "master" && collectionTiming !== "manual" && <div className={styles.field}><label>{monthlyBilling ? "Monthly company earning (CAD)" : perVisitBilling ? "Company earning per Visit (CAD)" : "Exact company earning (CAD)"}</label><input name="providerPayout" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.providerPayoutCents || 0) / 100 : ""} required /></div>}
              <div className={styles.field}><label>Starts on</label><input name="startsOn" type="date" defaultValue={selectedAgreement?.contractStartsOn || today()} required /></div>
              <div className={styles.field}><label>Ends on</label><input name="endsOn" type="date" defaultValue={selectedAgreement?.contractEndsOn || ""} /></div>
              <div className={styles.field}><label>Feedback window</label><select name="feedbackHours" defaultValue={selectedAgreement?.feedbackWindowHours || 24}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></div>
              {monthlyBilling && <><div className={styles.field}><label>Billing day</label><input name="billingDay" type="number" min="1" max="28" defaultValue={1} /></div><div className={styles.field}><label>Service starts day</label><input name="serviceStartDay" type="number" min="1" max="28" placeholder="Optional" /></div></>}
            </div>
            {!selectedCustomer ? <div className={styles.scopeLock}>No customer selected. Choose one in Customer workspace.</div> : !canEditSelected ? <div className={`${styles.scopeLock} ${styles.notice}`}>This platform customer is managed by Master. Commercial terms are hidden from the company.</div> : <div className={styles.notice}>{monthlyBilling ? "Monthly plan: one customer invoice per period. Visits prove delivery and control the company earning release." : perVisitBilling ? "Each completed Visit follows the feedback/Task protection flow before the customer invoice and company earning can be released." : "One-time work follows the same protected service/payment audit unless Master explicitly chooses manual collection."}</div>}
            <div className={styles.actions}><button type="submit" className={styles.button} disabled={saving || !selectedJob || !canEditSelected}>{saving ? "Saving and syncing…" : monthlyBilling ? "Save monthly contract & generate visits" : perVisitBilling ? "Save per-Visit contract & generate visits" : "Save one-time contract & generate visit"}</button></div>
          </form>
        </section>}

        {tab === "requests" && scope === "master" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Master-only payment actions</span><h2>Create or reopen customer payment</h2><p>Only Master can create standalone customer charges. Company Admins have no manual payment-link capability.</p></div><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void load()} disabled={loading}>{loading ? "Syncing..." : "Refresh"}</button></header>
          <form className={styles.manualRequest} onSubmit={(event) => { event.preventDefault(); void createManualRequestLink(true); }}>
            <div className={styles.embeddedPicker}><div><strong>{selectedCustomer?.name || "Choose a customer"}</strong><small>{selectedCustomer ? `${selectedCustomer.email || "No email"} · ${label(selectedCustomer.origin)}` : "Find the account first, then enter the amount and reason."}</small></div>{customerPicker("compact")}</div>
            <div className={styles.requestFormGrid}><div className={styles.field}><label>Amount to charge (CAD)</label><input type="number" min="0" step="0.01" value={requestAmount} onChange={(event) => setRequestAmount(event.target.value)} placeholder="0.00" /></div><div className={styles.field}><label>Description / reason</label><input value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="Additional service or approved adjustment" /></div><button type="submit" className={styles.button} disabled={!selectedCustomer || creatingManualRequest}>{creatingManualRequest ? "Creating..." : "Create & open link"}</button></div>
            {!selectedCustomer ? <div className={styles.scopeLock}>Choose a customer to create a Master payment action.</div> : <div className={styles.notice}>The resulting invoice remains auditable and company earnings are not released until the applicable service/payment checks pass.</div>}
          </form>
          <div className={styles.cards}>{visiblePaymentRequests.length === 0 ? <div className={styles.empty}>No payment requests or invoices in this scope yet.</div> : visiblePaymentRequests.map((invoice) => {
            const customer = workspace.customers.find((item) => item.id === invoice.customerId);
            const paid = invoice.status === "paid";
            const hasLink = Boolean(paymentLinks[invoice.id] || invoice.stripeCheckoutSessionId);
            return <article className={styles.requestItem} key={invoice.id}><div className={styles.eventIcon}>$</div><div><strong>{customer?.name || "Customer"}</strong><span>{invoice.number} · {invoice.serviceName || "Service invoice"}</span><small>{new Date(invoice.createdAt).toLocaleString("en-CA")} · {label(invoice.status)} · {money(invoice.totalCents)}</small></div><div className={styles.requestActions}><em className={`${styles.pill} ${paid ? "" : styles.hold}`}>{paid ? "paid" : hasLink ? "link created" : "needs link"}</em>{!paid && <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={requestingInvoiceId === invoice.id} onClick={() => void createRequestLink(invoice.id)}>{requestingInvoiceId === invoice.id ? "Creating..." : hasLink ? "Refresh link" : "Create link"}</button>}{!paid && <button type="button" className={styles.button} disabled={requestingInvoiceId === invoice.id} onClick={() => openRequestLink(invoice.id)}>Open link</button>}</div></article>;
          })}</div>
        </section>}

        {tab === "holds" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Protected release</span><h2>Feedback and Task holds</h2><p>{selectedCustomer ? `Showing holds for ${selectedCustomer.name}.` : "Select a customer to narrow the list."}</p></div></header><div className={styles.cards}>{visibleHolds.length === 0 ? <div className={styles.empty}>No protected holds right now.</div> : visibleHolds.map((event) => <article className={styles.event} key={event.id}><div className={styles.eventIcon}>◷</div><div><strong>{workspace.customers.find((customer) => customer.id === event.customerId)?.name || "Customer"}</strong><span>Visit {event.visitId.slice(0, 8)}</span><small>{event.feedbackDeadlineAt ? `Review until ${new Date(event.feedbackDeadlineAt).toLocaleString("en-CA")}` : "Operational review"}</small></div><em className={`${styles.pill} ${event.state.includes("failed") ? styles.issue : styles.hold}`}>{label(event.state)}</em></article>)}</div></section>}

        {tab === "payouts" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Commercial release rules</span><h2>{scope === "master" ? "Platform share and company earnings" : "Company earning rules"}</h2><p>Actual Pending / Available / Paid Out money is tracked in the Company Receivables ledger.</p></div></header><div className={styles.cards}>{visibleAgreements.length === 0 ? <div className={styles.empty}>No active payout rules yet.</div> : visibleAgreements.map((agreement) => <article className={styles.event} key={agreement.id}><div className={styles.eventIcon}>$</div><div><strong>{workspace.customers.find((customer) => customer.id === agreement.customerId)?.name || "Customer"}</strong><span>{label(agreement.billingModel)} · {label(agreement.serviceFrequency)}</span><small>{scope === "master" ? `Platform share ${money(Math.max(0, Number(agreement.customerAmountCents || 0) - Number(agreement.providerPayoutCents || 0)))}` : `Configured company earning ${money(agreement.providerPayoutCents)}`}</small></div><em className={styles.pill}>{agreement.ownerRole}</em></article>)}</div></section>}
      </main>

      <aside className={styles.side}>
        <section className={styles.sideCard}><span>How it works</span><h3>{scope === "master" ? "Master customer control" : "Company customer control"}</h3><p>{scope === "master" ? "Weekly and biweekly are per-Visit. Monthly is per billing period. Customer payment and company earning release are separate, reconciled steps." : "The company can manage its own customer contracts, but cannot create manual payment links. Platform customers remain commercially controlled by Master."}</p><dl><div><dt>Weekly / biweekly</dt><dd>Per Visit</dd></div><div><dt>Monthly</dt><dd>Per period</dd></div><div><dt>Manual charges</dt><dd>Master only</dd></div></dl></section>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span>Selected account</span><h2>{selectedCustomer?.name || "None"}</h2><p>{selectedJob?.serviceName || "No service selected"}</p></div></header><div className={styles.form}>{selectedAgreement && !companyRestricted ? <div className={styles.notice}><strong>{label(selectedAgreement.serviceFrequency)}</strong><br />{label(selectedAgreement.billingModel)}<br />{selectedAgreement.collectionTiming === "period_prepaid" ? "Monthly period collection" : label(selectedAgreement.collectionTiming)}<br />{selectedAgreement.contractStartsOn || "No start date"} → {selectedAgreement.contractEndsOn || "Open ended"}</div> : <div className={styles.scopeLock}>{companyRestricted ? "Commercial details are managed privately by Master." : selectedCustomer ? "No active billing agreement for this job." : "Choose a customer to open the account."}</div>}</div></section>
      </aside>
    </section>
  </div>;
}
