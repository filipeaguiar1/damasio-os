"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import { useCustomerTips } from "@/lib/hooks/useCustomerTips";

const creditOptions = [5, 10, 20, 50, 100];
const tipOptions = [5, 10, 20];

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default function CustomerPayments() {
  const [selectedCredits, setSelectedCredits] = useState<number[]>([]);
  const [customCredits, setCustomCredits] = useState("");
  const [editingCredits, setEditingCredits] = useState(false);
  const [tipAmount, setTipAmount] = useState("");
  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();
  const tips = useCustomerTips();

  const customAmount = Number(customCredits);
  const validCustom = Number.isInteger(customAmount) && customAmount >= 5 && customAmount <= 1000;
  const selectedTotal = useMemo(() => selectedCredits.reduce((sum, credits) => sum + credits, 0) + (editingCredits && validCustom ? customAmount : 0), [selectedCredits, editingCredits, validCustom, customAmount]);

  function toggleCredits(credits: number) {
    setSelectedCredits((current) => current.includes(credits) ? current.filter((value) => value !== credits) : [...current, credits]);
  }

  function addCredits() {
    if (!Number.isInteger(selectedTotal) || selectedTotal < 5 || selectedTotal > 1000) return;
    void wallet.topUp(selectedTotal);
  }

  const visibleMessage = billing.message || wallet.message || tips.message;

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="billing-hero">
        <div><span className="eyebrow">Secure billing</span><h1>Payments</h1><p>Pay invoices, add wallet credits, or send an optional tip through Stripe.</p></div>
        <div className="billing-secure-badge"><i>✓</i><span><strong>Protected checkout</strong><small>Card information stays with Stripe</small></span></div>
      </div>

      <section className="billing-summary" aria-label="Billing summary">
        <article className="due"><span>Wallet credits</span><strong>{wallet.loading ? "…" : wallet.balanceCredits.toFixed(0)}</strong><small>1 credit = $1 CAD</small></article>
        <article><span>Amount due</span><strong>{money(billing.summary.due)}</strong><small>{billing.summary.openCount} open invoice{billing.summary.openCount === 1 ? "" : "s"}</small></article>
        <article><span>Payment method</span><strong>Stripe</strong><small>Card checkout available in test mode</small></article>
      </section>

      {visibleMessage && <div className="billing-message">{visibleMessage}</div>}

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Wallet</span><h2>Add credits</h2><p>Select one or more amounts. Click a selected amount again to remove it.</p></div><button className="billing-refresh" type="button" onClick={() => void wallet.reload()} disabled={wallet.loading}>{wallet.loading ? "Loading..." : "Refresh balance"}</button></header>
        <div className="billing-invoice-list"><article><div className="billing-invoice-icon">$</div><div className="billing-invoice-copy"><span>Choose amounts</span><strong>1 credit equals $1 CAD</strong><small>Total must be between 5 and 1,000 credits.</small></div><div className="billing-invoice-total" style={{ alignItems: "stretch", gap: 12, minWidth: 320 }}><div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>{creditOptions.map((credits) => { const selected = selectedCredits.includes(credits); return <button key={credits} className={selected ? "btn btn-primary" : "btn btn-outline"} type="button" aria-pressed={selected} disabled={wallet.openingCredits > 0} onClick={() => toggleCredits(credits)}>{selected ? `✓ ${credits}` : `${credits}`} credits</button>; })}<button className={editingCredits ? "btn btn-primary" : "btn btn-outline"} type="button" aria-pressed={editingCredits} disabled={wallet.openingCredits > 0} onClick={() => setEditingCredits((value) => !value)}>Custom</button></div>{editingCredits && <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}><input aria-label="Custom credit amount" type="number" min={5} max={1000} step={1} placeholder="Custom" value={customCredits} onChange={(event) => setCustomCredits(event.target.value)} style={{ width: 130 }} /><small>{customCredits && !validCustom ? "Enter 5–1,000" : "Custom amount"}</small></div>}<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 16 }}><div style={{ textAlign: "right" }}><span style={{ display: "block" }}>Selected total</span><strong style={{ fontSize: 24 }}>{selectedTotal} credits · {money(selectedTotal)}</strong></div><button className="btn btn-primary" type="button" disabled={wallet.openingCredits > 0 || selectedTotal < 5 || selectedTotal > 1000} onClick={addCredits}>{wallet.openingCredits > 0 ? "Opening Stripe..." : "Add credits"}</button></div></div></article></div>
      </section>

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Invoices and quotes</span><h2>Ready for card payment</h2><p>Approved quotes become invoices and can be paid securely by card.</p></div><button className="billing-refresh" type="button" onClick={() => void billing.reload()} disabled={billing.loading}>{billing.loading ? "Loading..." : "Refresh"}</button></header>
        {billing.loading ? <div className="billing-empty"><i>…</i><strong>Loading billing</strong><p>Checking your connected invoices.</p></div> : billing.invoices.length === 0 ? <div className="billing-empty"><i>✓</i><strong>No invoices due</strong><p>Approved quotes and new invoices will appear here automatically.</p></div> : <div className="billing-invoice-list">{billing.invoices.map((invoice) => { const paid = invoice.status === "paid"; return <article key={invoice.id} className={paid ? "paid" : ""}><div className="billing-invoice-icon">{paid ? "✓" : "$"}</div><div className="billing-invoice-copy"><span>{invoice.number}</span><strong>{invoice.service}</strong><small>{new Date(invoice.createdAt).toLocaleDateString("en-CA")} · {statusLabel(invoice.status)}</small></div><div className="billing-invoice-total"><strong>{money(invoice.total)}</strong>{paid ? <span>Paid</span> : <button className="btn btn-primary" type="button" disabled={billing.payingId === invoice.id || billing.source !== "live"} onClick={() => void billing.checkout(invoice.id)}>{billing.payingId === invoice.id ? "Opening..." : "Pay by card"}</button>}</div></article>; })}</div>}
      </section>

      <section className="billing-panel">
        <header><div><span className="billing-kicker">Optional tip</span><h2>Send a tip by card</h2><p>Tips are separate from invoice payments and wallet credits.</p></div></header>
        <div className="billing-invoice-list"><article><div className="billing-invoice-icon">★</div><div className="billing-invoice-copy"><span>Choose tip</span><strong>Thank the service team</strong><small>Use a quick amount or enter a custom tip from $1 to $500.</small></div><div className="billing-invoice-total" style={{ alignItems: "stretch", gap: 10, minWidth: 300 }}><div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>{tipOptions.map((amount) => <button key={amount} className={Number(tipAmount) === amount ? "btn btn-primary" : "btn btn-outline"} type="button" onClick={() => setTipAmount(String(amount))}>${amount}</button>)}<input aria-label="Custom tip amount" type="number" min={1} max={500} step="0.01" placeholder="Custom" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} style={{ width: 120 }} /></div><button className="btn btn-primary" type="button" disabled={tips.opening || Number(tipAmount) < 1 || Number(tipAmount) > 500} onClick={() => void tips.sendTip(Number(tipAmount))}>{tips.opening ? "Opening Stripe..." : "Pay tip by card"}</button></div></article></div>
      </section>

      <section className="billing-help-strip"><div><i>i</i><span><strong>Stripe test mode</strong><small>Use test card 4242 4242 4242 4242, any future expiry date and any CVC.</small></span></div><Link className="btn btn-outline" href="/customer/requests">Request help</Link></section>
    </PortalShell>
  );
}
