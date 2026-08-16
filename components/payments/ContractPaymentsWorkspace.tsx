"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  emptyWorkspace,
  generateAgreementVisits,
  getPaymentsWorkspace,
  saveAgreement,
  syncAgreementToStripe,
  type PaymentsWorkspace,
} from "@/lib/repositories/paymentsWorkspaceRepository";
import styles from "./ContractPaymentsWorkspace.module.css";

type Scope = "master" | "company";
type Tab = "overview" | "contracts" | "holds" | "payouts";
type CollectionTiming = "after_visit" | "manual";

function money(cents?: number | null) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((cents || 0) / 100);
}

function label(value?: string | null) {
  return (value || "not set").replaceAll("_", " ");
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
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [collectionTiming, setCollectionTiming] = useState<CollectionTiming>("after_visit");

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
    setCollectionTiming(selectedAgreement?.collectionTiming === "manual" ? "manual" : "after_visit");
  }, [selectedAgreement?.id]);

  const visibleCustomers = selectedCustomer ? [selectedCustomer] : workspace.customers;
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

  async function submitContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !selectedCustomer || !canEditSelected) return;

    const form = new FormData(event.currentTarget);
    const customerAmount = Math.round(Number(form.get("customerAmount") || 0) * 100);
    const providerPayout = Math.round(Number(form.get("providerPayout") || 0) * 100);
    const frequency = String(form.get("frequency") || "one_time");
    const billingModel = collectionTiming === "manual"
      ? "manual"
      : String(form.get("billingModel") || (scope === "master" ? "per_visit_fixed_payout" : "per_visit_percentage_fee"));
    const startsOn = String(form.get("startsOn") || today());
    const endsOn = String(form.get("endsOn") || "") || null;
    const feedbackHours = Number(form.get("feedbackHours") || 24);

    if (!customerAmount || customerAmount < 0) return setMessage("Enter the customer contract amount.");
    if (scope === "master" && collectionTiming === "after_visit" && providerPayout <= 0) return setMessage("Master contracts require the exact company payout.");
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
        providerPayoutCents: scope === "master" && collectionTiming === "after_visit" ? providerPayout : null,
        platformFeeBasisPoints: null,
        contractStartsOn: startsOn,
        contractEndsOn: endsOn,
        feedbackWindowHours: feedbackHours,
        prepaidPlanType: null,
        planBillingDay: 1,
        serviceStartDay: null,
      });

      if (collectionTiming === "after_visit") {
        await syncAgreementToStripe(agreementId);
      }

      const created = await generateAgreementVisits(agreementId);
      setMessage(collectionTiming === "after_visit"
        ? `Contract saved, synced with Stripe, and ${created} future visit${created === 1 ? "" : "s"} created.`
        : `Manual contract saved and ${created} future visit${created === 1 ? "" : "s"} created. No automatic Stripe charge was configured.`);
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
  const tabs: Tab[] = companyRestricted ? ["overview"] : ["overview", "contracts", "holds", "payouts"];

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div><small>{scope === "master" ? "Master financial control" : "Company financial operations"}</small><h1>{title}</h1><p>{subtitle}</p></div>
      <div className={styles.heroBadge}><i>✓</i><div><strong>Canonical billing</strong><span>One contract source · Stripe for automated billing</span></div></div>
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
      <label><span>Customer</span><select value={selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedJobId(""); setTab("overview"); }}><option value="">None</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {label(customer.origin)}</option>)}</select></label>
    </section>

    <section className={styles.layout}>
      <main className={styles.main}>
        <nav className={styles.tabs}>{tabs.map((item) => <button key={item} type="button" className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>{label(item)}</button>)}</nav>

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
          <header className={styles.panelHeader}><div><span>Contract builder</span><h2>Define service and billing</h2><p>Select the customer above, then choose the active service job. Prepaid automation remains disabled until its billing-cycle worker is fully validated.</p></div></header>
          <form className={styles.form} onSubmit={submitContract} key={`${selectedCustomerId}-${selectedAgreement?.id || "new"}`}>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.wide}`}><label>Selected customer</label><input value={selectedCustomer?.name || "None"} readOnly /></div>
              <div className={`${styles.field} ${styles.wide}`}><label>Service job</label><select value={selectedJob?.id || ""} onChange={(event) => setSelectedJobId(event.target.value)} disabled={!selectedCustomer}><option value="">None</option>{customerJobs.map((job) => <option key={job.id} value={job.id}>{job.serviceName}</option>)}</select></div>
              <div className={styles.field}><label>Frequency</label><select name="frequency" defaultValue={selectedAgreement?.serviceFrequency || "weekly"}><option value="one_time">One time</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></div>
              <div className={styles.field}><label>Collection</label><select name="collectionTiming" value={collectionTiming} onChange={(event) => setCollectionTiming(event.target.value as CollectionTiming)}><option value="after_visit">After each visit</option><option value="manual">Manual</option></select></div>
              <div className={styles.field}><label>Billing model</label><select name="billingModel" key={collectionTiming} defaultValue={collectionTiming === "manual" ? "manual" : selectedAgreement?.billingModel === "per_visit_fixed_payout" || selectedAgreement?.billingModel === "per_visit_percentage_fee" ? selectedAgreement.billingModel : scope === "master" ? "per_visit_fixed_payout" : "per_visit_percentage_fee"}>{collectionTiming === "manual" ? <option value="manual">Manual</option> : <><option value="per_visit_fixed_payout">Per visit · fixed company payout</option><option value="per_visit_percentage_fee">Per visit · percentage model</option></>}</select></div>
              <div className={styles.field}><label>Customer amount (CAD)</label><input name="customerAmount" type="number" min="0.50" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.customerAmountCents || 0) / 100 : ""} required /></div>
              {scope === "master" && collectionTiming === "after_visit" && <div className={styles.field}><label>Exact company payout (CAD)</label><input name="providerPayout" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.providerPayoutCents || 0) / 100 : ""} required /></div>}
              <div className={styles.field}><label>Starts on</label><input name="startsOn" type="date" defaultValue={selectedAgreement?.contractStartsOn || today()} required /></div>
              <div className={styles.field}><label>Ends on</label><input name="endsOn" type="date" defaultValue={selectedAgreement?.contractEndsOn || ""} /></div>
              <div className={styles.field}><label>Feedback window</label><select name="feedbackHours" defaultValue={selectedAgreement?.feedbackWindowHours || 24}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></div>
            </div>
            {!selectedCustomer ? <div className={styles.scopeLock}>No customer selected. Choose one in Customer workspace.</div> : !canEditSelected ? <div className={`${styles.scopeLock} ${styles.notice}`}>This platform customer is managed by Master. Commercial terms are hidden from the company.</div> : <div className={styles.notice}>{collectionTiming === "manual" ? "Manual collection records the contract and schedule without creating an automatic Stripe charge." : scope === "master" ? "The company receives the exact payout configured. Stripe processing is absorbed by the platform share." : "Company-owned customer contract. Platform deductions happen automatically from the canonical agreement."}</div>}
            <div className={styles.actions}><button type="submit" className={styles.button} disabled={saving || !selectedJob || !canEditSelected}>{saving ? "Saving…" : collectionTiming === "manual" ? "Save manual contract & generate visits" : "Save contract, sync Stripe & generate visits"}</button></div>
          </form>
        </section>}

        {tab === "holds" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Protected release</span><h2>Feedback and Task holds</h2><p>{selectedCustomer ? `Showing holds for ${selectedCustomer.name}.` : "Select a customer to narrow the list."}</p></div></header><div className={styles.cards}>{visibleHolds.length === 0 ? <div className={styles.empty}>No protected holds right now.</div> : visibleHolds.map((event) => <article className={styles.event} key={event.id}><div className={styles.eventIcon}>◷</div><div><strong>{workspace.customers.find((customer) => customer.id === event.customerId)?.name || "Customer"}</strong><span>Visit {event.visitId.slice(0, 8)}</span><small>{event.feedbackDeadlineAt ? `Review until ${new Date(event.feedbackDeadlineAt).toLocaleString("en-CA")}` : "Operational review"}</small></div><em className={`${styles.pill} ${event.state.includes("failed") ? styles.issue : styles.hold}`}>{label(event.state)}</em></article>)}</div></section>}

        {tab === "payouts" && !companyRestricted && <section className={styles.panel}><header className={styles.panelHeader}><div><span>Separate charges and transfers</span><h2>{scope === "master" ? "Platform share and company payouts" : "Company payout rules"}</h2><p>{selectedCustomer ? `Showing payout rules for ${selectedCustomer.name}.` : "Select a customer to narrow the list."}</p></div></header><div className={styles.cards}>{visibleAgreements.length === 0 ? <div className={styles.empty}>No active payout rules yet.</div> : visibleAgreements.map((agreement) => <article className={styles.event} key={agreement.id}><div className={styles.eventIcon}>$</div><div><strong>{workspace.customers.find((customer) => customer.id === agreement.customerId)?.name || "Customer"}</strong><span>{label(agreement.billingModel)} · {label(agreement.serviceFrequency)}</span><small>{scope === "master" ? `Platform revenue ${money(Math.max(0, Number(agreement.customerAmountCents || 0) - Number(agreement.providerPayoutCents || 0)))}` : `Company payout ${money(agreement.providerPayoutCents)}`}</small></div><em className={styles.pill}>{agreement.ownerRole}</em></article>)}</div></section>}
      </main>

      <aside className={styles.side}>
        <section className={styles.sideCard}><span>How it works</span><h3>{scope === "master" ? "Master customer control" : "Company customer control"}</h3><p>{scope === "master" ? "Choose a platform customer, define what the customer pays, and set the exact company payout. Stripe processing is paid from the platform share." : "Choose a company-owned customer and define billing terms. Platform-owned contracts, holds, and payout details remain private."}</p><dl><div><dt>No selection</dt><dd>None</dd></div><div><dt>Contract editor</dt><dd>{scope === "master" ? "Platform customers" : "Company customers only"}</dd></div><div><dt>Automatic Stripe</dt><dd>After-visit only</dd></div></dl></section>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span>Selected account</span><h2>{selectedCustomer?.name || "None"}</h2><p>{selectedJob?.serviceName || "No service selected"}</p></div></header><div className={styles.form}>{selectedAgreement && !companyRestricted ? <div className={styles.notice}><strong>{label(selectedAgreement.serviceFrequency)}</strong><br />{label(selectedAgreement.billingModel)}<br />{selectedAgreement.contractStartsOn || "No start date"} → {selectedAgreement.contractEndsOn || "Open ended"}</div> : <div className={styles.scopeLock}>{companyRestricted ? "Commercial details are managed privately by Master." : selectedCustomer ? "No active billing agreement for this job." : "Choose a customer to open the account."}</div>}</div></section>
      </aside>
    </section>
  </div>;
}
