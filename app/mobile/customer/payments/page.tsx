"use client";

import { useEffect, useState } from "react";
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

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function MobileCustomerPayments() {
  const wallet = useCustomerWallet();
  const billing = useCustomerBilling();
  const [servicePaymentMethod, setServicePaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [tipPaymentMethod, setTipPaymentMethod] = useState<CustomerPaymentMethod>("card");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(25);

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
      <div className="role-mobile-form-card">
        <label><span>Services</span><select value={servicePaymentMethod} onChange={(event)=>setServicePaymentMethod(event.target.value as CustomerPaymentMethod)} disabled={loading||saving}><option value="card">Credit or debit card</option><option value="account_balance">Account balance</option></select></label>
        <label><span>Tips</span><select value={tipPaymentMethod} onChange={(event)=>setTipPaymentMethod(event.target.value as CustomerPaymentMethod)} disabled={loading||saving}><option value="card">Credit or debit card</option><option value="account_balance">Account balance</option></select></label>
        <button type="button" className="role-mobile-primary-button" disabled={loading||saving} onClick={()=>void save()}>{saving?"Saving...":"Save preferences"}</button>
      </div>
    </section>

    <section className="role-mobile-section">
      <div className="role-mobile-section-head"><div><span>ADD CREDITS</span><h2>Top up balance</h2></div></div>
      <div className="role-mobile-form-card">
        <label><span>Amount (CAD)</span><select value={amount} onChange={(event)=>setAmount(Number(event.target.value))}><option value={10}>$10</option><option value={25}>$25</option><option value={50}>$50</option><option value={100}>$100</option><option value={250}>$250</option></select></label>
        <button type="button" className="role-mobile-primary-button" disabled={wallet.openingCredits>0} onClick={()=>void wallet.topUp(amount)}>{wallet.openingCredits>0?"Opening Stripe...":`Add ${money(amount)}`}</button>
      </div>
    </section>

    <section className="role-mobile-section">
      <div className="role-mobile-section-head"><div><span>RECENT ACTIVITY</span><h2>Payments</h2></div></div>
      {wallet.transactions.length===0?<div className="role-mobile-clear"><i>✓</i><span><strong>No transactions yet</strong><small>Your activity will appear here.</small></span></div>:wallet.transactions.slice(0,6).map((item)=><article className="role-mobile-priority" key={item.id}><i>{item.credits>=0?"+":"−"}</i><span><strong>{item.description||label(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString("en-CA")}</small></span><b>{item.credits>=0?"+":""}{money(item.credits)}</b></article>)}
    </section>

    <MobileCustomerNav active="billing"/>
  </main></MobileRoleGuard>;
}
