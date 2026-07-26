"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  emptyWorkspace,
  generateAgreementVisits,
  getPaymentsWorkspace,
  saveAgreement,
  type PaymentsWorkspace,
} from "@/lib/repositories/paymentsWorkspaceRepository";
import styles from "./ContractPaymentsWorkspace.module.css";

type Scope = "master" | "company";
type Tab = "overview" | "contracts" | "holds" | "payouts";

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

  async function load() {
    setLoading(true);
    try {
      const data = await getPaymentsWorkspace(scope);
      setWorkspace(data);
      if (!selectedCustomerId && data.customers[0]) setSelectedCustomerId(data.customers[0].id);
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
  const canEditSelected = Boolean(selectedCustomer && (scope === "master" ? selectedCustomer.origin === "platform" : selectedCustomer.origin !== "platform"));

  useEffect(() => {
    if (selectedJob && selectedJob.id !== selectedJobId) setSelectedJobId(selectedJob.id);
  }, [selectedCustomerId, selectedJob?.id]);

  const metrics = useMemo(() => {
    const active = workspace.agreements.filter((agreement) => agreement.active);
    const holds = workspace.events.filter((event) => ["task_hold", "awaiting_feedback", "payout_pending"].includes(event.state));
    const paid = workspace.events.filter((event) => ["charged", "transferred", "paid_out"].includes(event.state));
    const payoutCents = active.reduce((sum, agreement) => sum + Number(agreement.providerPayoutCents || 0), 0);
    return { active: active.length, holds: holds.length, paid: paid.length, payoutCents };
  }, [workspace]);

  async function submitContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !selectedCustomer || !canEditSelected) return;
    const form = new FormData(event.currentTarget);
    const customerAmount = Math.round(Number(form.get("customerAmount") || 0) * 100);
    const providerPayout = Math.round(Number(form.get("providerPayout") || 0) * 100);
    const platformFeePercent = Number(form.get("platformFeePercent") || 0);
    const frequency = String(form.get("frequency") || "one_time");
    const billingModel = String(form.get("billingModel") || "manual");
    const collectionTiming = String(form.get("collectionTiming") || "after_visit");
    const startsOn = String(form.get("startsOn") || today());
    const endsOn = String(form.get("endsOn") || "") || null;
    const feedbackHours = Number(form.get("feedbackHours") || 24);
    const prepaidPlanType = collectionTiming === "period_prepaid" ? String(form.get("prepaidPlanType") || "monthly") : null;

    if (!customerAmount || customerAmount < 0) {
      setMessage("Enter the customer contract amount.");
      return;
    }
    if (scope === "master" && providerPayout <= 0) {
      setMessage("Master contracts require the exact provider payout.");
      return;
    }
    if (scope === "company" && (platformFeePercent < 0 || platformFeePercent > 100)) {
      setMessage("Enter a valid platform fee percentage.");
      return;
    }

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
        platformFeeBasisPoints: scope === "company" ? Math.round(platformFeePercent * 100) : null,
        contractStartsOn: startsOn,
        contractEndsOn: endsOn,
        feedbackWindowHours: feedbackHours,
        prepaidPlanType,
        planBillingDay: Number(form.get("billingDay") || 1),
        serviceStartDay: Number(form.get("serviceStartDay") || 0) || null,
        customFrequencyInterval: frequency === "custom" ? Number(form.get("customInterval") || 1) : null,
        customFrequencyUnit: frequency === "custom" ? String(form.get("customUnit") || "week") : null,
      });
      const created = await generateAgreementVisits(agreementId);
      setMessage(`Contract saved. ${created} future visit${created === 1 ? "" : "s"} created from the agreement.`);
      await load();
      setTab("overview");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Contract could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const holds = workspace.events.filter((event) => ["task_hold", "awaiting_feedback", "payout_pending", "charge_failed", "payment_failed"].includes(event.state));
  const title = scope === "master" ? "Platform Payments" : "Payments";
  const subtitle = scope === "master"
    ? "Define platform-owned customer contracts, customer collection, provider payout, and protected release rules."
    : "Manage company-owned customer contracts, invoices, holds, and payouts without exposing platform customer card failures.";

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div><small>{scope === "master" ? "Master financial control" : "Company financial operations"}</small><h1>{title}</h1><p>{subtitle}</p></div>
      <div className={styles.heroBadge}><i>✓</i><div><strong>Canonical billing</strong><span>One contract source · protected payouts</span></div></div>
    </section>

    {message && <div className={styles.message}>{message}</div>}

    <section className={styles.metrics}>
      <article className={styles.metric}><span>Customers</span><strong>{workspace.customers.length}</strong><small>{scope === "master" ? "platform owned" : "served by this company"}</small></article>
      <article className={styles.metric}><span>Active contracts</span><strong>{metrics.active}</strong><small>immutable active versions</small></article>
      <article className={styles.metric}><span>Protected holds</span><strong>{metrics.holds}</strong><small>feedback, Tasks, or payout review</small></article>
      <article className={styles.metric}><span>Provider value</span><strong>{money(metrics.payoutCents)}</strong><small>{scope === "master" ? "fixed payouts configured" : "visible contract payouts"}</small></article>
    </section>

    <section className={styles.layout}>
      <main className={styles.main}>
        <nav className={styles.tabs}>
          {(["overview", "contracts", "holds", "payouts"] as Tab[]).map((item) => <button key={item} type="button" className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>{label(item)}</button>)}
        </nav>

        {tab === "overview" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Live contract board</span><h2>Customers and service plans</h2><p>Contract ownership follows the customer acquisition source.</p></div><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void load()} disabled={loading}>{loading ? "Syncing…" : "Refresh"}</button></header>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Customer</th><th>Origin</th><th>Service</th><th>Next visit</th><th>Contract</th><th>Owner</th></tr></thead><tbody>
            {workspace.customers.length === 0 ? <tr><td colSpan={6}>No customers available in this scope.</td></tr> : workspace.customers.map((customer) => {
              const job = workspace.jobs.find((item) => item.customerId === customer.id);
              const agreement = workspace.agreements.find((item) => item.customerId === customer.id && item.active);
              return <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.email || "No email"}</small></td><td><span className={styles.pill}>{label(customer.origin)}</span></td><td>{job?.serviceName || "No active job"}</td><td>{job?.nextVisitDate || "Not generated"}</td><td>{agreement ? label(agreement.billingModel) : "Needs setup"}</td><td>{customer.origin === "platform" ? "Master" : "Company"}</td></tr>;
            })}
          </tbody></table></div>
        </section>}

        {tab === "contracts" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Contract builder</span><h2>Define service and billing</h2><p>The saved contract generates future visits and controls who can edit commercial terms.</p></div></header>
          <form className={styles.form} onSubmit={submitContract}>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.wide}`}><label>Customer</label><select value={selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedJobId(""); }}><option value="">Choose customer</option>{workspace.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {label(customer.origin)}</option>)}</select></div>
              <div className={`${styles.field} ${styles.wide}`}><label>Service job</label><select value={selectedJob?.id || ""} onChange={(event) => setSelectedJobId(event.target.value)}><option value="">Choose active job</option>{customerJobs.map((job) => <option key={job.id} value={job.id}>{job.serviceName}</option>)}</select></div>
              <div className={styles.field}><label>Frequency</label><select name="frequency" defaultValue={selectedAgreement?.serviceFrequency || "weekly"}><option value="one_time">One time</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></div>
              <div className={styles.field}><label>Collection</label><select name="collectionTiming" defaultValue={selectedAgreement?.collectionTiming || "after_visit"}><option value="after_visit">After each visit</option><option value="period_prepaid">Period prepaid</option><option value="manual">Manual</option></select></div>
              <div className={styles.field}><label>Billing model</label><select name="billingModel" defaultValue={selectedAgreement?.billingModel || (scope === "master" ? "per_visit_fixed_payout" : "per_visit_percentage_fee")}><option value="per_visit_fixed_payout">Per visit · fixed provider payout</option><option value="per_visit_percentage_fee">Per visit · percentage fee</option><option value="monthly_fixed_subscription">Monthly fixed plan</option><option value="weekly_subscription">Weekly subscription</option><option value="biweekly_subscription">Biweekly subscription</option><option value="manual">Manual</option></select></div>
              <div className={styles.field}><label>Customer amount (CAD)</label><input name="customerAmount" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.customerAmountCents || 0) / 100 : ""} required /></div>
              {scope === "master" ? <div className={styles.field}><label>Exact company payout (CAD)</label><input name="providerPayout" type="number" min="0" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.providerPayoutCents || 0) / 100 : ""} required /></div> : <div className={styles.field}><label>Platform fee (%)</label><input name="platformFeePercent" type="number" min="0" max="100" step="0.01" defaultValue={selectedAgreement ? (selectedAgreement.platformFeeBasisPoints || 0) / 100 : 15} /></div>}
              <div className={styles.field}><label>Starts on</label><input name="startsOn" type="date" defaultValue={selectedAgreement?.contractStartsOn || today()} required /></div>
              <div className={styles.field}><label>Ends on</label><input name="endsOn" type="date" defaultValue={selectedAgreement?.contractEndsOn || ""} /></div>
              <div className={styles.field}><label>Feedback window</label><select name="feedbackHours" defaultValue={selectedAgreement?.feedbackWindowHours || 24}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></div>
              <div className={styles.field}><label>Prepaid plan</label><select name="prepaidPlanType" defaultValue={selectedAgreement?.prepaidPlanType || "monthly"}><option value="monthly">Monthly</option><option value="seasonal">Seasonal</option></select></div>
              <div className={styles.field}><label>Billing day</label><input name="billingDay" type="number" min="1" max="28" defaultValue="1" /></div>
              <div className={styles.field}><label>Service starts day</label><input name="serviceStartDay" type="number" min="1" max="28" placeholder="5" /></div>
              <div className={styles.field}><label>Custom interval</label><input name="customInterval" type="number" min="1" defaultValue="1" /></div>
              <div className={styles.field}><label>Custom unit</label><select name="customUnit" defaultValue="week"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
            </div>
            {!selectedCustomer ? <div className={styles.scopeLock}>Choose a customer to configure the contract.</div> : !canEditSelected ? <div className={`${styles.scopeLock} ${styles.notice}`}>This is a platform-owned customer. The company can see service and payout status, but only Master can change the commercial contract.</div> : <div className={styles.notice}>{scope === "master" ? "Master owns this platform customer contract and defines the exact company payout." : "This company owns the customer and may define the contract. The platform fee remains visible to the company admin."}</div>}
            <div className={styles.actions}><button type="submit" className={styles.button} disabled={saving || !selectedJob || !canEditSelected}>{saving ? "Saving contract…" : "Save contract & generate visits"}</button></div>
          </form>
        </section>}

        {tab === "holds" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Protected release</span><h2>Feedback and Task holds</h2><p>Payment and provider transfer remain separated until the service is approved.</p></div></header>
          <div className={styles.cards}>{holds.length === 0 ? <div className={styles.empty}>No protected holds right now.</div> : holds.map((event) => <article className={styles.event} key={event.id}><div className={styles.eventIcon}>◷</div><div><strong>{workspace.customers.find((customer) => customer.id === event.customerId)?.name || "Customer"}</strong><span>Visit {event.visitId.slice(0, 8)}</span><small>{event.feedbackDeadlineAt ? `Review until ${new Date(event.feedbackDeadlineAt).toLocaleString("en-CA")}` : "Operational review"}</small></div><em className={`${styles.pill} ${event.state.includes("failed") ? styles.issue : styles.hold}`}>{label(event.state)}</em></article>)}</div>
        </section>}

        {tab === "payouts" && <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Separate charges and transfers</span><h2>Company payout rules</h2><p>Customer payment never automatically means immediate provider payout.</p></div></header>
          <div className={styles.cards}>{workspace.agreements.filter((agreement) => agreement.active).length === 0 ? <div className={styles.empty}>No active payout rules yet.</div> : workspace.agreements.filter((agreement) => agreement.active).map((agreement) => <article className={styles.event} key={agreement.id}><div className={styles.eventIcon}>$</div><div><strong>{workspace.customers.find((customer) => customer.id === agreement.customerId)?.name || "Customer"}</strong><span>{label(agreement.billingModel)} · {label(agreement.serviceFrequency)}</span><small>{agreement.ownerRole === "master" ? `Fixed provider payout ${money(agreement.providerPayoutCents)}` : `Platform fee ${((agreement.platformFeeBasisPoints || 0) / 100).toFixed(2)}%`}</small></div><em className={styles.pill}>{agreement.ownerRole}</em></article>)}</div>
        </section>}
      </main>

      <aside className={styles.side}>
        <section className={styles.sideCard}><span>Ownership rule</span><h3>{scope === "master" ? "Master-owned customers" : "Company-owned contracts"}</h3><p>{scope === "master" ? "Platform customers stay commercially controlled by Master even after a service company is assigned." : "The company can edit only customers it acquired. Platform customer payment failures remain private to Master."}</p><dl><div><dt>Contract editor</dt><dd>{scope === "master" ? "Platform customers" : "Company customers"}</dd></div><div><dt>Payment failures</dt><dd>{scope === "master" ? "Visible" : "Private clients only"}</dd></div><div><dt>Visit generation</dt><dd>From active contract</dd></div></dl></section>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span>Selected account</span><h2>{selectedCustomer?.name || "Choose customer"}</h2><p>{selectedJob?.serviceName || "No service selected"}</p></div></header><div className={styles.form}>{selectedAgreement ? <div className={styles.notice}><strong>{label(selectedAgreement.serviceFrequency)}</strong><br />{label(selectedAgreement.billingModel)}<br />{selectedAgreement.contractStartsOn || "No start date"} → {selectedAgreement.contractEndsOn || "Open ended"}</div> : <div className={styles.scopeLock}>No active billing agreement for this job.</div>}</div></section>
      </aside>
    </section>
  </div>;
}
