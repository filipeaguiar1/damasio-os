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

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default function CustomerPayments() {
  const {
    invoices,
    source,
    loading,
    message,
    payingId,
    summary,
    checkout,
    reload,
  } = useCustomerBilling();

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="billing-hero">
        <div>
          <span className="eyebrow">Secure billing</span>
          <h1>Payments</h1>
          <p>Review every invoice first, then pay through Stripe&apos;s encrypted checkout.</p>
        </div>
        <div className="billing-secure-badge">
          <i>✓</i>
          <span><strong>Protected checkout</strong><small>Card information stays with Stripe</small></span>
        </div>
      </div>

      <section className="billing-summary" aria-label="Billing summary">
        <article className="due">
          <span>Amount due</span>
          <strong>{money(summary.due)}</strong>
          <small>{summary.openCount} open invoice{summary.openCount === 1 ? "" : "s"}</small>
        </article>
        <article>
          <span>Paid invoices</span>
          <strong>{summary.paidCount}</strong>
          <small>Confirmed by payment records</small>
        </article>
        <article>
          <span>Payment method</span>
          <strong>Stripe</strong>
          <small>Cards and available bank options</small>
        </article>
      </section>

      {message && <div className="billing-message">{message}</div>}

      <section className="billing-panel">
        <header>
          <div>
            <span className="billing-kicker">Invoices</span>
            <h2>Ready for payment</h2>
            <p>Only invoices connected to your customer account appear here.</p>
          </div>
          <button className="billing-refresh" type="button" onClick={() => void reload()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </header>

        {loading ? (
          <div className="billing-empty"><i>…</i><strong>Loading billing</strong><p>Checking your connected invoices.</p></div>
        ) : invoices.length === 0 ? (
          <div className="billing-empty"><i>✓</i><strong>No invoices due</strong><p>New approved work will appear here automatically.</p></div>
        ) : (
          <div className="billing-invoice-list">
            {invoices.map((invoice) => {
              const paid = invoice.status === "paid";
              return (
                <article key={invoice.id} className={paid ? "paid" : ""}>
                  <div className="billing-invoice-icon">{paid ? "✓" : "$"}</div>
                  <div className="billing-invoice-copy">
                    <span>{invoice.number}</span>
                    <strong>{invoice.service}</strong>
                    <small>{new Date(invoice.createdAt).toLocaleDateString("en-CA")} · {statusLabel(invoice.status)}</small>
                  </div>
                  <div className="billing-invoice-total">
                    <strong>{money(invoice.total)}</strong>
                    {paid ? (
                      <span>Paid</span>
                    ) : (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={payingId === invoice.id || source !== "live"}
                        onClick={() => void checkout(invoice.id)}
                      >
                        {payingId === invoice.id ? "Opening..." : "Pay securely"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="billing-help-strip">
        <div><i>i</i><span><strong>Need another payment arrangement?</strong><small>Contact the company before the invoice due date.</small></span></div>
        <Link className="btn btn-outline" href="/customer/requests">Request help</Link>
      </section>
    </PortalShell>
  );
}
