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
  return "Payouts";
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
    return [customer.name, customer.email, customer.origin].some((value) =>
      String(value || "").toLowerCase().includes(normalizedQuery)
    );
  });
  const companyPaymentCustomerIds = new Set(workspace.customers.filter((customer) => customer.origin !== "platform").map((customer) => customer.id));

  useEffect(() => {
    if (!selectedCustomerId) {
      if (selectedJobId) setSelectedJobId("");
      return;
    }
    if (selectedJob && selectedJob.id !== selectedJobId) setSelectedJobId(selectedJob.id);
  }, [selectedCustomerId, selectedJob?.id]);

  useEffect(() => {
    if (companyRestricted && !["overview", "requests"].includes(tab)) setTab("overview");
  }, [companyRestricted, tab]);

  useEffect(() => {
    setCollectionTiming((selectedAgreement?.collectionTiming || "after_visit") as CollectionTiming);
  }, [selectedAgreement?.id]);

  const visibleCustomers = selectedCustomer ? [selectedCustomer] : filteredCustomers;
  const visiblePaymentRequests = workspace.invoices.filter((invoice) =>
    (!selectedCustomerId || invoice.customerId === selectedCustomerId)
    && (scope === "master" || companyPaymentCustomerIds.has(invoice.customerId))
  );
  const visibleHolds = workspace.events.filter((event) =>
    ["task_hold", "awaiting_feedback", "payout_pending", "charge_failed", "payment_failed"].includes(event.state)
    && (!selectedCustomerId || event.customerId === selectedCustomerId)
  );
  const visibleAgreements = workspace.agreements.filter((agreement) =>
    agreement.active && (!selectedCustomerId || agreement.customerId === selectedCustomerId)
  );

  const metrics = useMemo(() => {
    const active = workspace.agreements.filter((agreement) => agreement.active);
    const holds = workspace.events.filter((event) => ["task_hold", "awaiting_feedback", "payout_pending"].includes(event.state));
    const paid = workspace.events.filter((event) => ["charged", "transferred", "paid_out"].includes(event.state));
    const providerPayoutCents = active.reduce((sum, agreement) => sum + Number(agreement.providerPayoutCents || 0), 0);
    const platformRevenueCents = active.reduce((sum, agreement) => {
      if (agreement.ownerRole === "master") {
        return sum + Math.max(0, Number(agreement.customerAmountCents || 0) - Number(agreement.providerPayoutCents || 0));
      }
      return sum + Math.round(Number(agreement.customerAmountCents || 0) * Number(agreement.platformFeeBasisPoints || 0) / 10000);
    }, 0);
    return { active: active.length, holds: holds.length, paid: paid.length, providerPayoutCents, platformRevenueCents };
  }, [workspace]);

  async function createRequestLink(invoiceId: string, openAfterCreate = false) {
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
    if (!selectedCustomer || companyRestricted) return;
    const amountCents = Math.round(Number(requestAmount || 0) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
      setMessage("Enter the payment amount before creating the link.");
      return;
    }
    setCreatingManualRequest(true);
    setMessage("");
    try {
      const result = await createManualPaymentRequestLink({
        customerId: selectedCustomer.id,
        amountCents,
        description: requestDescription || "Service payment",
      });
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
    const url = paymentLinks[invoiceId];
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    void createRequestLink(invoiceId, true);
  }

  async function submitContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !selectedCustomer || !canEditSelected) return;
    const form = new FormData(event.currentTarget);
    const customerAmount = Math.round(Number(form.get("customerAmount") || 0) * 100);
    const providerPayout = Math.round(Number(form.get("providerPayout") || 0) * 100);
    const frequency = String(form.get("frequency") || "one_time");
    const billingModel = String(form.get("billingModel") || "manual");
    const startsOn = String(form.get("startsOn") || today());
    const endsOn = String(form.get("endsOn") || "") || null;
    const feedbackHours = Number(form.get("feedbackHours") || 24);
    const prepaidPlanType = collectionTiming === "period_prepaid" ? String(form.get("prepaidPlanType") || "monthly") : null;

    if (!customerAmount || customerAmount < 0) return setMessage("Enter the customer contract amount.");
    if (scope === "master" && providerPayout <= 0) return setMessage("Master contracts require the exact company payout.");
    if (scope === "master" && providerPayout > customerAmount) return setMessage("Company payout cannot exceed the customer amount.");

    setSaving(true);
    setMessage("");
    try {
      const agreementId = await saveAgreement({
        jobId: selectedJob.id,
        billingModel,
        collectionTiming,
        serviceFrequency: frequency,
        customerAmountCents: customerAmount,
        providerPayoutCents: scope === "master" ? providerPayout : null,
        platformFeeBasisPoints: null,
        contractStartsOn: startsOn,
        contractEndsOn: endsOn,
        feedbackWindowHours: feedbackHours,
        prepaidPlanType,
        planBillingDay: collectionTiming === "period_prepaid" ? Number(form.get("billingDay") || 1) : 1,
        serviceStartDay: collectionTiming === "period_prepaid" ? Number(form.get("serviceStartDay") || 0) || null : null,
      });
      await syncAgreementToStripe(agreementId);
      const created = await generateAgreementVisits(agreementId);
      setMessage(`Contract saved, synced with Stripe, and ${created} future visit${created === 1 ? "" : "s"} created.`);
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
    ? "Define platform-owned customer contracts, customer collection, company payout, and protected release rules."
    : "Manage company-owned customer contracts and operational payments. Platform-owned commercial terms stay private.";
  const tabs: Tab[] = companyRestricted ? ["overview", "requests"] : ["overview", "contracts", "requests", "holds", "payouts"];

  const customerPicker = (mode: "compact" | "full" = "full") => <div className={mode === "compact" ? styles.inlineCustomerPicker : styles.customerFind}>
    <label><span>Find customer</span><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Search name, email or origin" /></label>
    <label><span>Customer</span><select value={selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedJobId(""); }}><option value="">Choose customer</option>{filteredCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {label(customer.origin)}</option>)}</select></label>
  </div>;

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div><small>{scope === "master" ? "Master financial control" : "Company financial operations"}</small><h1>{title}</h1><p>{subtitle}</p></div>
      <div className={styles.heroActions}>
        <button type="button" className={`${styles.button} ${styles.heroButton}`} onClick={() => setTab("requests")}>Request Payment Link</button>
        <div className={styles.heroBadge}><i>✓</i><div><strong>Canonical billing</strong><span>One contract source · Stripe synced</span></div></div>
      </div>
    </section>

    {message && <div className={styles.message}>{message}</div>}

    <section className={styles.metrics}>
      <article className={styles.metric}><span>Customers</span><strong>{workspace.customers.length}</strong><small>{scope === "master" ? "platform owned" : "served by this company"}</small></article>
      <article className={styles.metric}><span>Active contracts</span><strong>{metrics.active}</strong><small>active agreement versions</small></article>
      <article className={styles.metric}><span>Protected holds</span><strong>{metrics.holds}</strong><small>feedback or Task review</small></article>
      <article className={styles.metric}><span>{scope === "master" ? "Platform revenue" : "Company payout value"}</span><strong>{money(scope === "master" ? metrics.platformRevenueCents : metrics.providerPayoutCents)}</strong><small>{scope === "master" ? "gross platform share; Stripe fee is absorbed here" : "visible payout amounts only"}</small></article>
    </section>

    <section className={styles.customerSelector}>
      <div><span>Customer workspace</span><strong>{selectedCustomer?.name || "None"}</strong><small>Select a customer to view or configure only that account.</small></div>
      {customerPicker()}
    </section>

    <section className={styles.layout}>
      <main className={styles.main}>
        <nav className={styles.tabs}>{tabs.map((item) => <button key={item} type="button" className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>{tabLabel(item)}</button>)}</nav>

        {tab === "overview" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Live contract board</span><h2>{selectedCustomer ? "Selected customer" : "Customers and service plans"}</h2><p>{companyRestricted ? "This platform customer is operational only. Commercial contract, holds, and payout rules are private to Master." : selectedCustomer ? "Showing only the selected account." : "Select a customer above or review all available accounts."}</p></div><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void load()} disabled={loading}>{loading ? "Syncing…" : "Refresh"}</button></header>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Customer</th><th>Origin</th><th>Service</th><th>Next visit</th><th>Contract</th><th>Owner</th></tr></thead><tbody>
            {visibleCustomers.length === 0 ? <tr><td colSpan={6}>No customers available in this scope.</td></tr> : visibleCustomers.map((customer) => {
              const job = workspace.jobs.find((item) => item.customerId === customer.id);
              const agreement = workspace.agreements.find((item) => item.customerId === customer.id && item.active);
              const hideCommercial = scope === "company" && customer.origin === "platform";
              return <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.email || "No email"}</small></td><td><span className={styles.pill}>{label(customer.origin)}</span></td><td>{job?.serviceName || "No active job"}</td><td>{job?.nextVisitDate || "Not generated"}</td><td>{hideCommercial ? "Managed by Master" : agreement ? label(agreement.billingModel) : "Needs setup"}</td><td>{customer.origin === "platform" ? "Master" : "Company"}</td></tr>;
            })}
          </tbody></table></div>
        </section>}

        {tab === "contracts" && !companyRestricted && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Contract builder</span><h2>Define service and billing</h2><p>Select the customer above, then choose the active service job.</p></div></header>
          <form className={styles.form} onSubmit={submitContract} key={`${selectedCustomerId}-${selectedAgreement?.id || "new"}`}>
            <div className={styles.embeddedPicker}>
              <div><strong>{selectedCustomer?.name || "Choose a customer"}</strong><small>{selectedCustomer ? `${selectedCustomer.email || "No email"} · ${label(selectedCustomer.origin)}` : "Search by name or email to edit the contract faster."}</small></div>
              {customerPicker("compact")}
            </div>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.wide}`}><label>Selected customer</label><input value={selectedCustomer?.name || "None"} readOnly /></div>
              <div className={`${styles.field} ${styles.wide}`}><label>Service job</label><select value={selectedJob?.id || ""} onChange={(event) => setSelectedJobId(event.target.value)} disabled={!selectedCustomer}><option value="">None</option>{customerJobs.map((job) => <option key={job.id} value={job.id}>{job.serviceName}</option>)}</select></div>
              <div className={styles.field}><label>Frequency</label><select name="frequency" defaultValue={selectedAgreement?.serviceFrequency || "weekly"}><option value="one_time">One time</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></div>
              <div className={styles.field}><label>Collection</label><select name="collectionTiming" value={collectionTiming} onChange={(event) => setCollectionTiming(event.target.value as CollectionTiming)}><option value="after_visit">After each visit</option><option value="period_prepaid">Prepaid plan</option><option value="manual">Manual</option></select></div>
              <div className={styles.field}><label>Billing model</label><select name="billingModel" defaultValue={selectedAgreement?.billingModel || (scope === "master" ? "per_visit_fixed_payout" : "per_visit_percentage_fee")}><option value="per_visit_fixed_payout">Per visit · fixed company payout</option><option value="per_visit_percentage_fee">Per visit · percentage model</option><option value="monthly_fixed_subscription">Monthly fixed plan</option><option value="weekly_subscription">Weekly subscription</option><option value="biweekly_subscription">Biweekly subscription</option><option value="manual">Manual</option></select></div>
              <div className={styles.field}><label>Customer amount (CAD)</label><input name="customerAmount" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.customerAmountCents || 0) / 100 : ""} required /></div>
              {scope === "master" && <div className={styles.field}><label>Exact company payout (CAD)</label><input name="providerPayout" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.providerPayoutCents || 0) / 100 : ""} required /></div>}
              <div className={styles.field}><label>Starts on</label><input name="startsOn" type="date" defaultValue={selectedAgreement?.contractStartsOn || today()} required /></div>
              <div className={styles.field}><label>Ends on</label><input name="endsOn" type="date" defaultValue={selectedAgreement?.contractEndsOn || ""} /></div>
              <div className={styles.field}><label>Feedback window</label><select name="feedbackHours" defaultValue={selectedAgreement?.feedbackWindowHours || 24}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></div>
              {collectionTiming === "period_prepaid" && <>
                <div className={styles.field}><label>Prepaid plan</label><select name="prepaidPlanType" defaultValue={selectedAgreement?.prepaidPlanType || "monthly"}><option value="monthly">Monthly</option><option value="seasonal">Seasonal</option><option value="annual">Annual</option></select></div>
                <div className={styles.field}><label>Billing day</label><input name="billingDay" type="number" min="1" max="28" defaultValue="1" /></div>
                <div className={styles.field}><label>Service starts day</label><input name="serviceStartDay" type="number" min="1" max="28" placeholder="5" /></div>
              </>}
            </div>
            {!selectedCustomer ? <div className={styles.scopeLock}>No customer selected. Choose one in Customer workspace.</div> : !canEditSelected ? <div className={`${styles.scopeLock} ${styles.notice}`}>This platform customer is managed by Master. Commercial terms are hidden from the company.</div> : <div className={styles.notice}>{scope === "master" ? "The company receives the exact payout configured. Stripe processing is absorbed by the platform share." : "Company-owned customer contract. Platform deductions happen automatically and are not configured here."}</div>}
            <div className={styles.actions}><button type="submit" className={styles.button} disabled={saving || !selectedJob || !canEditSelected}>{saving ? "Saving and syncing…" : "Save contract, sync Stripe & generate visits"}</button></div>
          </form>
        </section>}

        {tab === "requests" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Payment actions</span><h2>Request payment link</h2><p>{scope === "company" ? "Only company-owned customers can receive payment requests here. Master/platform customers are blocked." : "Create or reopen Stripe Checkout links, or create a manual payment request by customer and amount."}</p></div><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void load()} disabled={loading}>{loading ? "Syncing..." : "Refresh"}</button></header>
          <form className={styles.manualRequest} onSubmit={(event) => { event.preventDefault(); void createManualRequestLink(true); }}>
            <div className={styles.embeddedPicker}>
              <div><strong>{selectedCustomer?.name || "Choose a customer"}</strong><small>{selectedCustomer ? `${selectedCustomer.email || "No email"} · ${label(selectedCustomer.origin)}` : "Find the account first, then enter the amount to charge."}</small></div>
              {customerPicker("compact")}
            </div>
            <div className={styles.requestFormGrid}>
              <div className={styles.field}><label>Amount to charge (CAD)</label><input type="number" min="0" step="0.01" value={requestAmount} onChange={(event) => setRequestAmount(event.target.value)} placeholder="0.00" /></div>
              <div className={styles.field}><label>Description</label><input value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="Service payment" /></div>
              <button type="submit" className={styles.button} disabled={!selectedCustomer || companyRestricted || creatingManualRequest}>{creatingManualRequest ? "Creating..." : "Create & open link"}</button>
            </div>
            {!selectedCustomer ? <div className={styles.scopeLock}>Choose a customer to create a payment request.</div> : companyRestricted ? <div className={`${styles.scopeLock} ${styles.requestLock}`}>This is a Master/platform customer. The company cannot create payment requests for this account.</div> : <div className={styles.notice}>This creates an open invoice for the selected amount and opens Stripe Checkout.</div>}
          </form>
          {scope === "company" && selectedCustomer?.origin === "platform" && <div className={`${styles.scopeLock} ${styles.requestLock}`}>This is a Master/platform customer. The company can see operational context, but payment requests are not available for this account.</div>}
          <div className={styles.cards}>
            {visiblePaymentRequests.length === 0 ? <div className={styles.empty}>{selectedCustomer ? "No open invoice history yet. Use the form above to create the first request." : "No payment requests or open invoices in this scope yet."}</div> : visiblePaymentRequests.map((invoice) => {
              const customer = workspace.customers.find((item) => item.id === invoice.customerId);
              const paid = invoice.status === "paid";
              const canRequest = !paid && (scope === "master" || customer?.origin !== "platform");
              const hasLink = Boolean(paymentLinks[invoice.id] || invoice.stripeCheckoutSessionId);
              return <article className={styles.requestItem} key={invoice.id}>
                <div className={styles.eventIcon}>$</div>
                <div><strong>{customer?.name || "Customer"}</strong><span>{invoice.number} · {invoice.serviceName || "Service invoice"}</span><small>{new Date(invoice.createdAt).toLocaleString("en-CA")} · {label(invoice.status)} · {money(invoice.totalCents)}</small></div>
                <div className={styles.requestActions}>
                  <em className={`${styles.pill} ${paid ? "" : styles.hold}`}>{paid ? "paid" : hasLink ? "link created" : "needs link"}</em>
                  {!paid && <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={!canRequest || requestingInvoiceId === invoice.id} onClick={() => void createRequestLink(invoice.id)}>{requestingInvoiceId === invoice.id ? "Creating..." : hasLink ? "Refresh link" : "Create link"}</button>}
                  {!paid && <button type="button" className={styles.button} disabled={!canRequest || requestingInvoiceId === invoice.id} onClick={() => openRequestLink(invoice.id)}>Open link</button>}
                </div>
              </article>;
            })}
          </div>
        </section>}

        {tab === "holds" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Protected release</span><h2>Feedback and Task holds</h2><p>{selectedCustomer ? `Showing holds for ${selectedCustomer.name}.` : "Select a customer to narrow the list."}</p></div></header><div className={styles.cards}>{visibleHolds.length === 0 ? <div className={styles.empty}>No protected holds right now.</div> : visibleHolds.map((event) => <article className={styles.event} key={event.id}><div className={styles.eventIcon}>◷</div><div><strong>{workspace.customers.find((customer) => customer.id === event.customerId)?.name || "Customer"}</strong><span>Visit {event.visitId.slice(0, 8)}</span><small>{event.feedbackDeadlineAt ? `Review until ${new Date(event.feedbackDeadlineAt).toLocaleString("en-CA")}` : "Operational review"}</small></div><em className={`${styles.pill} ${event.state.includes("failed") ? styles.issue : styles.hold}`}>{label(event.state)}</em></article>)}</div></section>}

        {tab === "payouts" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Separate charges and transfers</span><h2>{scope === "master" ? "Platform share and company payouts" : "Company payout rules"}</h2><p>{selectedCustomer ? `Showing payout rules for ${selectedCustomer.name}.` : "Select a customer to narrow the list."}</p></div></header><div className={styles.cards}>{visibleAgreements.length === 0 ? <div className={styles.empty}>No active payout rules yet.</div> : visibleAgreements.map((agreement) => <article className={styles.event} key={agreement.id}><div className={styles.eventIcon}>$</div><div><strong>{workspace.customers.find((customer) => customer.id === agreement.customerId)?.name || "Customer"}</strong><span>{label(agreement.billingModel)} · {label(agreement.serviceFrequency)}</span><small>{scope === "master" ? `Platform revenue ${money(Math.max(0, Number(agreement.customerAmountCents || 0) - Number(agreement.providerPayoutCents || 0)))}` : `Company payout ${money(agreement.providerPayoutCents)}`}</small></div><em className={styles.pill}>{agreement.ownerRole}</em></article>)}</div></section>}
      </main>

      <aside className={styles.side}>
        <section className={styles.sideCard}><span>How it works</span><h3>{scope === "master" ? "Master customer control" : "Company customer control"}</h3><p>{scope === "master" ? "Choose a platform customer, define what the customer pays, and set the exact company payout. Stripe processing is paid from the platform share." : "Choose a company-owned customer and define billing terms. Platform-owned contracts, holds, and payout details remain private."}</p><dl><div><dt>No selection</dt><dd>None</dd></div><div><dt>Contract editor</dt><dd>{scope === "master" ? "Platform customers" : "Company customers only"}</dd></div><div><dt>Stripe</dt><dd>Synced on save</dd></div></dl></section>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span>Selected account</span><h2>{selectedCustomer?.name || "None"}</h2><p>{selectedJob?.serviceName || "No service selected"}</p></div></header><div className={styles.form}>{selectedAgreement && !companyRestricted ? <div className={styles.notice}><strong>{label(selectedAgreement.serviceFrequency)}</strong><br />{label(selectedAgreement.billingModel)}<br />{selectedAgreement.contractStartsOn || "No start date"} → {selectedAgreement.contractEndsOn || "Open ended"}</div> : <div className={styles.scopeLock}>{companyRestricted ? "Commercial details are managed privately by Master." : selectedCustomer ? "No active billing agreement for this job." : "Choose a customer to open the account."}</div>}</div></section>
      </aside>
    </section>
  </div>;
}
