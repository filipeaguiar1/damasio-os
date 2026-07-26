"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractPaymentsWorkspace } from "@/components/payments/ContractPaymentsWorkspace";
import styles from "@/components/payments/ContractPaymentsWorkspace.module.css";
import { DAMASIO_SYNC_EVENT, getInvoices, type Invoice } from "@/lib/storage";

type View = "payments" | "invoices";

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function Finance() {
  const [view, setView] = useState<View>("payments");
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  function refreshInvoices() {
    setInvoices(getInvoices());
  }

  useEffect(() => {
    refreshInvoices();
    const refresh = () => refreshInvoices();
    window.addEventListener(DAMASIO_SYNC_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <AdminShell active="Payments">
      <div className={styles.tabs} style={{ marginBottom: 16, width: "fit-content" }}>
        <button type="button" className={view === "payments" ? styles.active : ""} onClick={() => setView("payments")}>Payments & Contracts</button>
        <button type="button" className={view === "invoices" ? styles.active : ""} onClick={() => setView("invoices")}>Invoices</button>
      </div>

      {view === "payments" ? <ContractPaymentsWorkspace scope="company" /> : <div className={styles.shell}>
        <section className={styles.hero}>
          <div><small>Company billing documents</small><h1>Invoices</h1><p>Invoices remain inside Payments, without a duplicate item in the customer navigation.</p></div>
          <div className={styles.heroBadge}><i>$</i><div><strong>Billing records</strong><span>Customer, service, total, and status</span></div></div>
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span>Invoice manager</span><h2>All invoices</h2><p>Review the invoice list here or open the complete manager for editing and collection actions.</p></div><div style={{ display: "flex", gap: 8 }}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={refreshInvoices}>Refresh</button><Link className={styles.button} href="/admin/invoices" style={{ textDecoration: "none" }}>Manage invoices</Link></div></header>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Invoice</th><th>Customer</th><th>Service</th><th>Total</th><th>Status</th></tr></thead><tbody>
            {invoices.length === 0 ? <tr><td colSpan={5}>No invoices yet.</td></tr> : invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong><small>{new Date(invoice.createdAt).toLocaleDateString("en-CA")}</small></td><td>{invoice.customer}</td><td>{invoice.service}</td><td>{money(invoice.total)}</td><td><span className={styles.pill}>{label(invoice.status)}</span></td></tr>)}
          </tbody></table></div>
        </section>
      </div>}
    </AdminShell>
  );
}
