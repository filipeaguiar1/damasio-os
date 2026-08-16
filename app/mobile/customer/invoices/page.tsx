"use client";

import Link from "next/link";
import { useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { useCustomerBilling } from "@/lib/hooks/useCustomerBilling";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function humanStatus(value?: string | null) {
  const status = String(value || "waiting_payment").replaceAll("_", " ");
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function MobileCustomerInvoicesPage() {
  const billing = useCustomerBilling();
  const wallet = useCustomerWallet();
  const [message, setMessage] = useState("");

  async function payFromBalance(invoiceId: string, total: number) {
    if (wallet.balanceCredits < total) {
      setMessage(`Your available balance is ${money(wallet.balanceCredits)}. Add funds before paying this invoice from balance.`);
      return;
    }
    if (!window.confirm(`Pay ${money(total)} from your 4Ever Seasons account balance?`)) return;

    try {
      const result = await billing.payWithWallet(invoiceId);
      setMessage(result?.message || "Invoice paid from account balance.");
      await wallet.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account balance payment failed.");
    }
  }

  const visibleMessage = message || billing.message || wallet.message;

  return <MobileRoleGuard allowed={["customer"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
      <header className="role-mobile-topbar">
        <MobileBackButton fallback="/mobile/customer" />
        <div><strong>Invoices</strong><span>Billing documents</span></div>
        <Link href="/mobile/customer/profile" className="role-mobile-avatar role-mobile-profile-avatar" aria-label="Open customer profile">CU</Link>
      </header>

      <section className="customer-native-hero invoices">
        <span>BILLING</span>
        <h1>{money(billing.summary.due)} due.</h1>
        <p>{money(wallet.balanceCredits)} available in account balance</p>
      </section>

      {visibleMessage && <div className="customer-native-message">
        {visibleMessage}
        <button onClick={() => { setMessage(""); billing.clearMessage(); wallet.clearMessage(); }}>×</button>
      </div>}

      <section className="customer-document-list">
        {billing.invoices.map((item) => {
          const paid = item.status === "paid";
          const walletEnough = wallet.balanceCredits >= item.total;
          return <article key={item.id}>
            <header>
              <div>
                <span>{item.number}</span>
                <strong>{item.service}</strong>
                <small>{new Date(item.createdAt).toLocaleDateString("en-CA")}</small>
              </div>
              <b>{money(item.total)}</b>
            </header>

            <div className="customer-invoice-status">
              <span>{humanStatus(item.status)}</span>
              <small>{paid ? "Confirmed" : item.walletEligible ? "Card or account balance" : "Card payment"}</small>
            </div>

            {!paid && <div className="row">
              <button
                className="customer-pay-button"
                disabled={billing.payingId === item.id || billing.payingWalletId === item.id || billing.source !== "live"}
                onClick={() => void billing.checkout(item.id)}
              >
                {billing.payingId === item.id ? "Opening Stripe..." : "Pay by card"}
              </button>

              {item.walletEligible && <button
                className="btn btn-outline"
                disabled={billing.payingWalletId === item.id || billing.payingId === item.id || wallet.loading}
                onClick={() => void payFromBalance(item.id, item.total)}
                title={walletEnough ? "Pay this invoice from account balance" : "Add more funds to use account balance"}
              >
                {billing.payingWalletId === item.id ? "Paying..." : walletEnough ? "Pay from balance" : "Balance too low"}
              </button>}
            </div>}
          </article>;
        })}

        {billing.loading
          ? <div className="customer-native-empty"><i>…</i><strong>Loading invoices</strong><p>Checking connected billing records.</p></div>
          : !billing.invoices.length && <div className="customer-native-empty"><i>≡</i><strong>No invoices</strong><p>Invoices connected to your account will appear here.</p></div>}
      </section>
    </main>
  </MobileRoleGuard>;
}
