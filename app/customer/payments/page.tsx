"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";

const depositOptions = [10, 25, 50, 100, 250];

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default function CustomerPayments() {
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();

  const customValue = Number(customAmount);
  const validCustom = Number.isInteger(customValue) && customValue >= 5 && customValue <= 1000;
  const depositAmount = useMemo(() => validCustom ? customValue : selectedAmount, [validCustom, customValue, selectedAmount]);
  const visibleMessage = billing.message || wallet.message;

  function chooseAmount(amount: number) {
    setSelectedAmount(amount);
    setCustomAmount("");
  }

  function deposit() {
    if (!Number.isInteger(depositAmount) || depositAmount < 5 || depositAmount > 1000) return;
    void wallet.topUp(depositAmount);
  }

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="billing-hero">
        <div><span className="eyebrow">Customer balance</span><h1>Payments</h1><p>Keep money on your account, pay invoices, and review every transaction in one place.</p></div>
        <div className="billing-secure-badge"><i>✓</i><span><strong>Real CAD balance</strong><small>Funds are added through Stripe and stored in cents</small></span></div>
      </div>

      {visibleMessage && <div className="billing-message">{visibleMessage}</div>}

      <section className="billing-summary" aria-label="Account summary">
        <article className="due"><span>Available balance</span><strong>{wallet.loading ? "…" : money(wallet.balanceCredits)}</strong><small>Usable for services and optional tips</small></article>
        <article><span>Outstanding invoices</span><strong>{money(billing.summary.due)}</strong><small>{billing.summary.openCount} open invoice{billing.summary.openCount === 1 ? "" : "s"}</small></article>
        <article><span>Payment protection</span><strong>Stripe secured</strong><small>Card details are never stored by Damasio OS</small></article>
      </section>

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Account funds</span><h2>Add money</h2><p>Choose an amount in Canadian dollars. This becomes real account balance after Stripe confirms payment.</p></div><button className="billing-refresh" type="button" onClick={() => void wallet.reload()} disabled={wallet.loading}>{wallet.loading ? "Loading..." : "Refresh balance"}</button></header>
        <div className="billing-invoice-list">
          <article>
            <div className="billing-invoice-icon">$</div>
            <div className="billing-invoice-copy"><span>Deposit amount</span><strong>{money(depositAmount || 0)}</strong><small>Minimum $5 CAD · Maximum $1,000 CAD</small></div>
            <div className="billing-invoice-total" style={{ alignItems: "stretch", gap: 12, minWidth: 340 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
                {depositOptions.map((amount) => <button key={amount} className={selectedAmount === amount && !customAmount ? "btn btn-primary" : "btn btn-outline"} type="button" disabled={wallet.openingCredits > 0} onClick={() => chooseAmount(amount)}>{money(amount)}</button>)}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
                <input aria-label="Custom deposit amount" type="number" min={5} max={1000} step={1} placeholder="Custom CAD" value={customAmount} onChange={(event) => { setCustomAmount(event.target.value); setSelectedAmount(0); }} style={{ width: 150 }} />
                <small>{customAmount && !validCustom ? "Enter $5–$1,000" : "Whole CAD amount"}</small>
              </div>
              <button className="btn btn-primary" type="button" disabled={wallet.openingCredits > 0 || depositAmount < 5 || depositAmount > 1000} onClick={deposit}>{wallet.openingCredits > 0 ? "Opening Stripe..." : `Add ${money(depositAmount || 0)}`}</button>
            </div>
          </article>
        </div>
      </section>

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Invoices</span><h2>Amount due</h2><p>Approved work appears here for secure payment.</p></div><button className="billing-refresh" type="button" onClick={() => void billing.reload()} disabled={billing.loading}>{billing.loading ? "Loading..." : "Refresh invoices"}</button></header>
        {billing.loading ? <div className="billing-empty"><i>…</i><strong>Loading invoices</strong><p>Checking your connected billing records.</p></div> : billing.invoices.length === 0 ? <div className="billing-empty"><i>✓</i><strong>No invoices due</strong><p>Your account is currently up to date.</p></div> : <div className="billing-invoice-list">{billing.invoices.map((invoice) => { const paid = invoice.status === "paid"; return <article key={invoice.id} className={paid ? "paid" : ""}><div className="billing-invoice-icon">{paid ? "✓" : "$"}</div><div className="billing-invoice-copy"><span>{invoice.number}</span><strong>{invoice.service}</strong><small>{new Date(invoice.createdAt).toLocaleDateString("en-CA")} · {statusLabel(invoice.status)}</small></div><div className="billing-invoice-total"><strong>{money(invoice.total)}</strong>{paid ? <span>Paid</span> : <button className="btn btn-primary" type="button" disabled={billing.payingId === invoice.id || billing.source !== "live"} onClick={() => void billing.checkout(invoice.id)}>{billing.payingId === invoice.id ? "Opening..." : "Pay invoice"}</button>}</div></article>; })}</div>}
      </section>

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Account activity</span><h2>Transaction history</h2><p>Every deposit, service payment, tip, refund, or adjustment is recorded.</p></div></header>
        {wallet.transactions.length === 0 ? <div className="billing-empty"><i>≡</i><strong>No transactions yet</strong><p>Your financial activity will appear here.</p></div> : <div className="billing-invoice-list">{wallet.transactions.map((item) => <article key={item.id}><div className="billing-invoice-icon">{item.credits >= 0 ? "+" : "−"}</div><div className="billing-invoice-copy"><span>{statusLabel(item.type)}</span><strong>{item.description || "Account transaction"}</strong><small>{new Date(item.createdAt).toLocaleString("en-CA")}</small></div><div className="billing-invoice-total"><strong>{item.credits >= 0 ? "+" : ""}{money(item.credits)}</strong><span>Balance {money(item.balanceAfterCredits)}</span></div></article>)}</div>}
      </section>

      <section className="billing-help-strip"><div><i>i</i><span><strong>Tips after service</strong><small>Optional tips are offered only from the feedback screen after a completed service.</small></span></div><Link className="btn btn-outline" href="/customer/feedback">Open feedback</Link></section>
    </PortalShell>
  );
}
