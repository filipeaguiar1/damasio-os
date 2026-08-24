"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./MasterManualInvoiceWorkspace.module.css";

type Company = { id: string; name: string; active?: boolean };
type Customer = { id: string; name: string; email: string | null; companyId: string | null; companyName: string; platformManaged: boolean };
type Visit = { id: string; date: string; status: string; serviceName: string; address: string; propertyId: string | null; jobId: string | null };
type Invoice = { id: string; invoice_number: string; status: string; total: number; visit_id?: string | null; manual_description?: string | null; created_at: string };
type Workspace = { companies: Company[]; customers: Customer[]; visits: Visit[]; invoices: Invoice[] };

const empty: Workspace = { companies: [], customers: [], visits: [], invoices: [] };

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value || 0));
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });
}

async function token() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new Error("Your Master session expired. Sign in again.");
  return access;
}

export function MasterManualInvoiceWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(empty);
  const [companyId, setCompanyId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [visitId, setVisitId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resultUrl, setResultUrl] = useState("");

  async function request(url: string, init?: RequestInit) {
    const access = await token();
    const response = await fetch(url, {
      ...init,
      headers: { ...(init?.headers || {}), authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Master billing request failed.");
    return body;
  }

  async function loadBase() {
    setLoading(true);
    try {
      const data = await request("/api/master/manual-invoices");
      setWorkspace(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Master billing could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomer(id: string) {
    setCustomerId(id);
    setVisitId("");
    setConfirmed(false);
    setResultUrl("");
    if (!id) {
      setWorkspace(current => ({ ...current, visits: [], invoices: [] }));
      return;
    }
    setLoading(true);
    try {
      const data = await request(`/api/master/manual-invoices?customerId=${encodeURIComponent(id)}`);
      setWorkspace(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer billing history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBase(); }, []);

  const customers = useMemo(() => workspace.customers.filter(customer => !companyId || customer.companyId === companyId), [workspace.customers, companyId]);
  const completedVisits = useMemo(() => workspace.visits.filter(visit => visit.status === "completed"), [workspace.visits]);
  const customer = workspace.customers.find(item => item.id === customerId) || null;
  const visit = completedVisits.find(item => item.id === visitId) || null;
  const amountCents = Math.round(Number(amount || 0) * 100);
  const validAmount = Number.isSafeInteger(amountCents) && amountCents >= 50 && amountCents <= 1_000_000;
  const ready = Boolean(customer && visit && validAmount && description.trim().length >= 8 && confirmed && !busy);

  async function create(sendEmail: boolean) {
    if (!ready || !customer || !visit) return;
    setBusy(true);
    setMessage("");
    setResultUrl("");
    try {
      const data = await request("/api/master/manual-invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, visitId: visit.id, amountCents, description: description.trim(), sendEmail }),
      });
      setResultUrl(data.invoiceUrl || "");
      setMessage(sendEmail
        ? data.emailSent
          ? `Invoice ${data.invoice.invoice_number} created and emailed successfully.`
          : `Invoice ${data.invoice.invoice_number} was created, but email delivery was not confirmed${data.emailError ? `: ${data.emailError}` : "."}`
        : `Invoice ${data.invoice.invoice_number} created. It has not been emailed yet.`);
      setAmount("");
      setDescription("");
      setConfirmed(false);
      await loadCustomer(customer.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual invoice could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span>MASTER CONTROLLED BILLING</span>
        <h2>Manual invoice review</h2>
        <p>Only Master can create an extra customer invoice. Every request must be tied to a completed Visit and is audit logged before the customer pays.</p>
      </div>
      <div className={styles.lock}>MASTER ONLY</div>
    </header>

    {message && <div className={styles.message}>{message}</div>}

    <div className={styles.grid}>
      <article className={styles.card}>
        <div className={styles.cardHead}><span>1 · CONTEXT</span><h3>Choose company and customer</h3></div>
        <label className={styles.field}><span>Company</span><select value={companyId} onChange={event => { setCompanyId(event.target.value); void loadCustomer(""); }}><option value="">All companies</option>{workspace.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className={styles.field}><span>Customer</span><select value={customerId} onChange={event => void loadCustomer(event.target.value)}><option value="">Select customer</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.companyName}</option>)}</select></label>
        {customer && <div className={styles.customer}><strong>{customer.name}</strong><span>{customer.email || "No email on file"}</span><small>{customer.platformManaged ? "Platform-managed customer" : customer.companyName}</small></div>}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHead}><span>2 · SERVICE PROOF</span><h3>Select completed Visit</h3></div>
        <label className={styles.field}><span>Completed Visit</span><select value={visitId} disabled={!customerId || loading} onChange={event => { setVisitId(event.target.value); setConfirmed(false); }}><option value="">Select Visit</option>{completedVisits.map(item => <option key={item.id} value={item.id}>{date(item.date)} · {item.serviceName} · {item.address}</option>)}</select></label>
        {customerId && !loading && completedVisits.length === 0 && <div className={styles.notice}>No completed Visit is available. A manual invoice cannot be created without completed service proof.</div>}
        {visit && <div className={styles.visit}><b>{visit.serviceName}</b><span>{date(visit.date)}</span><small>{visit.address}</small></div>}
      </article>

      <article className={`${styles.card} ${styles.billingCard}`}>
        <div className={styles.cardHead}><span>3 · BILLING</span><h3>Reason and amount</h3></div>
        <div className={styles.amountRow}>
          <label className={styles.field}><span>Amount (CAD)</span><input inputMode="decimal" type="number" min="0.50" max="10000" step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} placeholder="0.00" /></label>
          <div className={styles.amountPreview}><span>Invoice total</span><strong>{validAmount ? money(amountCents / 100) : "$0.00"}</strong></div>
        </div>
        <label className={styles.field}><span>Description / reason</span><textarea rows={4} value={description} onChange={event => { setDescription(event.target.value); setConfirmed(false); }} placeholder="Describe exactly why this additional charge is required and what happened on the selected Visit." /></label>
        <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the Customer, completed Visit, reason and amount. This invoice is ready for Master authorization.</span></label>
        <div className={styles.actions}><button type="button" disabled={!ready} onClick={() => void create(false)}>Create invoice only</button><button type="button" className={styles.primary} disabled={!ready} onClick={() => void create(true)}>{busy ? "Creating…" : "Create & send invoice"}</button></div>
        <p className={styles.guardrail}>This does not charge a stored card automatically. The customer receives a secure invoice and chooses to pay through the canonical Stripe Checkout flow.</p>
        {resultUrl && <a className={styles.link} href={resultUrl} target="_blank" rel="noreferrer">Open generated customer invoice ↗</a>}
      </article>
    </div>

    <article className={styles.history}>
      <div className={styles.cardHead}><span>AUDIT TRAIL</span><h3>Recent customer invoices</h3></div>
      {!customerId ? <div className={styles.empty}>Choose a customer to inspect invoice history.</div> : loading ? <div className={styles.empty}>Loading history…</div> : workspace.invoices.length === 0 ? <div className={styles.empty}>No invoices found for this customer.</div> : <div className={styles.list}>{workspace.invoices.map(invoice => <div className={styles.invoice} key={invoice.id}><div><strong>{invoice.invoice_number}</strong><span>{invoice.manual_description || "Service invoice"}</span><small>{date(invoice.created_at)}</small></div><div><b>{money(Number(invoice.total || 0))}</b><span className={styles.badge}>{String(invoice.status).replaceAll("_", " ")}</span></div></div>)}</div>}
    </article>
  </section>;
}
