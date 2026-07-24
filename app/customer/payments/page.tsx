"use client";

import { useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";

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
  const [customCredits, setCustomCredits] = useState("10");
  const [editingCredits, setEditingCredits] = useState(false);
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
  const wallet = useCustomerWallet();

  const submitCustomCredits = () => {
    const credits = Number(customCredits);
    if (!Number.isInteger(credits) || credits < 10 || credits > 1000) return;
    void wallet.topUp(credits);
  };

  const visibleMessage = message || wallet.message;

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="billing-hero">
        <div>
          <span className="eyebrow">Secure billing</span>
          <h1>Payments</h1>
          <p>Review invoices, add wallet credits, and pay through Stripe&apos;s encrypted checkout.</p>
        </div>
        <div className="billing-secure-badge">
          <i>✓</i>
          <span><strong>Protected checkout</strong><small>Card information stays with Stripe</small></span>
        </div>
      </div>

      <section className="billing-summary" aria-label="Billing summary">
        <article className="due">
          <span>Wallet credits</span>
          <strong>{wallet.loading ? "…" : wallet.balanceCredits.toFixed(0)}</strong>
          <small>1 credit = $1 CAD</small>
        </article>
        <article>
          <span>Amount due</span>
          <strong>{money(summary.due)}</strong>
          <small>{summary.openCount} open invoice{summary.openCount === 1 ? "" : "s"}</small>
        </article>
        <article>
          <span>Payment method</span>
          <strong>Stripe</strong>
          <small>Cards and available bank options</small>
        </article>
      </section>

      {visibleMessage && <div className="billing-message">{visibleMessage}</div>}

      <section className="billing-panel">
        <header>
          <div>
            <span className="billing-kicker">Wallet</span>
            <h2>Add credits</h2>
            <p>Credits remain available for future services and tips.</p>
          </div>
          <button className="billing-refresh" type="button" onClick={() => void wallet.reload()} disabled={wallet.loading}>
            {wallet.loading ? "Loading..." : "Refresh balance"}
          </button>
        </header>

        <div className="billing-invoice-list">
          <article>
            <div className="billing-invoice-icon">$</div>
            <div className="billing-invoice-copy">
              <span>Choose an amount</span>
              <strong>1 credit equals $1 CAD</strong>
              <small>Minimum 10 credits. Maximum 1,000 credits.</small>
            </div>
            <div className="billing-invoice-total" style={{ alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
                {[10, 20, 50, 100, 200].map((credits) => (
                  <button
                    key={credits}
                    className="btn btn-outline"
                    type="button"
                    disabled={wallet.openingCredits > 0}
                    onClick={() => void wallet.topUp(credits)}
                  >
                    {wallet.openingCredits === credits ? "Opening..." : `${credits} credits`}
                  </button>
                ))}
                <button className="btn btn-outline" type="button" onClick={() => setEditingCredits((value) => !value)}>
                  Edit
                </button>
              </div>
              {editingCredits && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <input
                    aria-label="Custom credit amount"
                    type="number"
                    min={10}
                    max={1000}
                    step={1}
                    value={customCredits}
                    onChange={(event) => setCustomCredits(event.target.value)}
                    style={{ width: 120 }}
                  />
                  <button className="btn btn-primary" type="button" disabled={wallet.openingCredits > 0} onClick={submitCustomCredits}>
                    Add credits
                  </button>
                </div>
              )}
            </div>
          </article>
        </div>
      </section>

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
