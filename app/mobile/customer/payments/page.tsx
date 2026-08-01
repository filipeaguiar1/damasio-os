"use client";

import { Suspense, useEffect, useState } from "react";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import {
  getCustomerPaymentPreferences,
  saveCustomerPaymentPreferences,
  type CustomerPaymentMethod,
} from "@/lib/repositories/customerPaymentPreferenceRepository";

const creditOptions = [10, 25, 50, 100];

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function PaymentChoice({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  value: CustomerPaymentMethod;
  onChange: (value: CustomerPaymentMethod) => void;
  disabled: boolean;
}) {
  return <div style={{ border: "1px solid rgba(15,23,42,.1)", borderRadius: 18, padding: 16, background: "#fff", boxShadow: "0 10px 30px rgba(15,23,42,.05)" }}>
    <div style={{ marginBottom: 12 }}><strong style={{ display: "block", fontSize: 16 }}>{title}</strong><span style={{ display: "block", marginTop: 4, color: "#64748b", fontSize: 13, lineHeight: 1.45 }}>{description}</span></div>
    <div style={{ display: "grid", gap: 10 }}>
      {(["card", "account_balance"] as CustomerPaymentMethod[]).map((method) => {
        const active = value === method;
        return <button key={method} type="button" disabled={disabled} onClick={() => onChange(method)} style={{ minHeight: 58, padding: "12px 14px", borderRadius: 15, border: active ? "2px solid #16a34a" : "1px solid #dbe3ee", background: active ? "#f0fdf4" : "#fff", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
          <span style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: active ? "#dcfce7" : "#f1f5f9", fontWeight: 800 }}>{method === "card" ? "▣" : "$"}</span>
          <span style={{ flex: 1 }}><strong style={{ display: "block" }}>{method === "card" ? "Credit or debit card" : "Account balance"}</strong><small style={{ color: "#64748b" }}>{method === "card" ? "Secure payment with Stripe" : "Use available credits first"}</small></span>
          <b style={{ color: "#16a34a" }}>{active ? "✓" : ""}</b>
        </button>;
      })}
    </div>
  </div>;
}

function MobileCustomerPaymentsContent() {
  const wallet = useCustomerWallet();
  const billing = useCustomerBilling();
  const [servicePaymentMethod, setServicePaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [tipPaymentMethod, setTipPaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(25);
  const [customAmount, setCustomAmount] = useState("");

  async function load() {
    setLoading(true);
    try {
      const preferences = await getCustomerPaymentPreferences();
      setServicePaymentMethod(preferences.servicePaymentMethod);
      setTipPaymentMethod(preferences.tipPaymentMethod);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment preferences could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await saveCustomerPaymentPreferences({ servicePaymentMethod, tipPaymentMethod });
      setMessage("Payment preferences saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const parsedCustom = Number(customAmount);
  const topUpAmount = customAmount ? parsedCustom : amount;
  const validTopUp = Number.isFinite(topUpAmount) && topUpAmount >= 5 && topUpAmount <= 1000;

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell role-customer-mobile">
    <header className="role-mobile-topbar"><MobileBackButton/><div><strong>Payments</strong><span>Account & billing</span></div><span className="role-mobile-avatar">$</span></header>
    {(message || wallet.message || billing.message) && <p className="mobile-message">{message || wallet.message || billing.message}</p>}

    <section className="mobile-hero-card compact role-customer-hero">
      <span className="role-mobile-eyebrow">ACCOUNT BALANCE</span>
      <h1>{wallet.loading ? "Loading..." : money(wallet.balanceCredits)}</h1>
      <p>Use your balance or saved card for services and optional tips.</p>
    </section>

    <section className="role-mobile-section">
      <div className="role-mobile-section-head"><div><span>PAYMENT METHODS</span><h2>Choose how you pay</h2></div></div>
      <div style={{ display: "grid", gap: 18 }}>
        <PaymentChoice title="Services" description="Select the default payment method for completed services." value={servicePaymentMethod} onChange={setServicePaymentMethod} disabled={loading || saving} />
        <PaymentChoice title="Tips" description="Tips are optional and use their own payment preference." value={tipPaymentMethod} onChange={setTipPaymentMethod} disabled={loading || saving} />
        <button type="button" className="role-mobile-primary-button" style={{ marginTop: 8, minHeight: 52 }} disabled={loading||saving} onClick={()=>void save()}>{saving?"Saving...":"Save preferences"}</button>
      </div>
    </section>

    <section className="role-mobile-section">
      <div className="role-mobile-section-head"><div><span>ADD CREDITS</span><h2>Top up balance</h2></div></div>
      <div style={{ borderRadius: 22, padding: 18, background: "linear-gradient(145deg,#ffffff,#f8fafc)", border: "1px solid rgba(15,23,42,.09)", boxShadow: "0 16px 40px rgba(15,23,42,.07)" }}>
        <div style={{ marginBottom: 16 }}><strong style={{ display: "block", fontSize: 17 }}>Choose an amount</strong><span style={{ display: "block", marginTop: 4, color: "#64748b", fontSize: 13 }}>Credits become available after Stripe confirms the payment.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          {creditOptions.map((option) => <button key={option} type="button" onClick={() => { setAmount(option); setCustomAmount(""); }} style={{ minHeight: 58, borderRadius: 16, border: !customAmount && amount === option ? "2px solid #16a34a" : "1px solid #dbe3ee", background: !customAmount && amount === option ? "#f0fdf4" : "#fff", fontSize: 18, fontWeight: 800 }}>{money(option)}</button>)}
        </div>
        <label style={{ display: "block", marginTop: 14 }}><span style={{ display: "block", marginBottom: 7, fontSize: 13, fontWeight: 700 }}>Custom amount</span><div style={{ display: "flex", alignItems: "center", minHeight: 54, borderRadius: 15, border: customAmount ? "2px solid #16a34a" : "1px solid #dbe3ee", background: "#fff", padding: "0 14px" }}><b style={{ marginRight: 8 }}>$</b><input aria-label="Custom credit amount" inputMode="decimal" type="number" min={5} max={1000} step="1" placeholder="Enter amount" value={customAmount} onChange={(event)=>setCustomAmount(event.target.value)} style={{ width: "100%", border: 0, outline: 0, minHeight: 50, fontSize: 17, background: "transparent" }} /></div></label>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><span style={{ color: "#64748b" }}>Top-up total</span><strong style={{ fontSize: 20 }}>{validTopUp ? money(topUpAmount) : "—"}</strong></div>
        <button type="button" className="role-mobile-primary-button" style={{ marginTop: 14, minHeight: 54 }} disabled={wallet.openingCredits>0 || !validTopUp} onClick={()=>void wallet.topUp(topUpAmount)}>{wallet.openingCredits>0?"Opening Stripe...":validTopUp?`Add ${money(topUpAmount)}`:"Enter at least $5"}</button>
      </div>
    </section>

    <section className="role-mobile-section">
      <div className="role-mobile-section-head"><div><span>RECENT ACTIVITY</span><h2>Payments</h2></div></div>
      {wallet.transactions.length===0?<div className="role-mobile-clear"><i>✓</i><span><strong>No transactions yet</strong><small>Your activity will appear here.</small></span></div>:wallet.transactions.slice(0,6).map((item)=><article className="role-mobile-priority" key={item.id}><i>{item.credits>=0?"+":"−"}</i><span><strong>{item.description||label(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString("en-CA")}</small></span><b>{item.credits>=0?"+":""}{money(item.credits)}</b></article>)}
    </section>

    <MobileCustomerNav active="billing"/>
  </main></MobileRoleGuard>;
}

export default function MobileCustomerPayments() {
  return <Suspense fallback={<main className="mobile-splash"><div className="mobile-logo-pulse"><span>4</span></div><h1>4Ever Seasons</h1><p>Loading payments...</p></main>}><MobileCustomerPaymentsContent /></Suspense>;
}
