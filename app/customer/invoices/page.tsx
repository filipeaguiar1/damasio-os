"use client";

import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";

function money(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

export default function Invoices() {
  const { invoices, loading, message, summary } = useCustomerBilling();

  return (
    <PortalShell type="Customer" active="Invoices">
      <div className="billing-hero invoice-hero">
        <div>
          <span className="eyebrow">Billing documents</span>
          <h1>Invoices</h1>
          <p>4 Ever Seasons branded invoices, monthly plan charges and verified payment status in one place.</p>
        </div>
        <Link className="btn btn-primary" href="/customer/payments">
          Open payments
        </Link>
      </div>

      <section className="billing-summary" aria-label="Invoice summary">
        <article><span>All invoices</span><strong>{invoices.length}</strong><small>Connected to your account</small></article>
        <article className="due"><span>Open balance</span><strong>{money(summary.due)}</strong><small>{summary.openCount} awaiting payment</small></article>
        <article><span>Paid</span><strong>{summary.paidCount}</strong><small>Stripe-confirmed or verified</small></article>
      </section>

      {message && <div className="billing-message">{message}</div>}

      <section className="billing-panel">
        <header>
          <div>
            <span className="billing-kicker">Documents</span>
            <h2>Invoice history</h2>
          </div>
        </header>
        {loading ? (
          <div className="billing-empty"><i>…</i><strong>Loading invoices</strong></div>
        ) : invoices.length === 0 ? (
          <div className="billing-empty"><i>≡</i><strong>No invoices yet</strong><p>Monthly billing and approved one-time work will create documents here.</p></div>
        ) : (
          <div className="billing-invoice-list">
            {invoices.map((invoice) => (
              <article key={invoice.id} className={invoice.status === "paid" ? "paid" : ""}>
                <div className="billing-invoice-icon">{invoice.status === "paid" ? "✓" : "≡"}</div>
                <div className="billing-invoice-copy">
                  <span>{invoice.number}</span>
                  <strong>{invoice.service}</strong>
                  <small>{new Date(invoice.createdAt).toLocaleDateString("en-CA")} · {invoice.status.replaceAll("_", " ")}</small>
                </div>
                <div className="billing-invoice-total">
                  <strong>{money(invoice.total)}</strong>
                  <Link className="btn btn-secondary" href={`/customer/invoices/${invoice.id}`}>View invoice</Link>
                  {invoice.status === "paid"
                    ? <span>Paid</span>
                    : <Link className="btn btn-primary" href={`/customer/invoices/${invoice.id}`}>Pay securely</Link>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </PortalShell>
  );
}
