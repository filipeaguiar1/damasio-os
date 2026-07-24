"use client";

import { useEffect, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { CustomerPaymentProfile, getCustomerPaymentProfile, getInvoices, saveCustomerPaymentProfile } from "@/lib/storage";

type CustomerInvoice = {
  id: string;
  number: string;
  status: string;
  total: number;
  service: string;
  createdAt: string;
};

export default function CustomerPayments() {
  const [profile, setProfile] = useState<CustomerPaymentProfile | null>(null);
  const [message, setMessage] = useState("");
  const [realInvoices, setRealInvoices] = useState<CustomerInvoice[]>([]);
  const [payingId, setPayingId] = useState("");

  useEffect(() => {
    setProfile(getCustomerPaymentProfile());
    void loadRealInvoices();
  }, []);

  async function loadRealInvoices() {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const response = await fetch("/api/customer/invoices", { headers: { authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (response.ok) setRealInvoices(result.invoices || []);
    } catch {
      setRealInvoices([]);
    }
  }

  function save(patch: Partial<CustomerPaymentProfile>) {
    setProfile(saveCustomerPaymentProfile(patch));
    setMessage("Payment preference saved.");
  }

  async function checkout(invoiceId: string) {
    setPayingId(invoiceId);
    setMessage("Opening secure Stripe Checkout...");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sign in before paying.");
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout could not be opened.");
      window.location.href = result.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be opened.");
      setPayingId("");
    }
  }

  if (!profile) {
    return <PortalShell type="Customer" active="Payments"><div className="card profile-card">Loading payments...</div></PortalShell>;
  }

  const localDue = getInvoices().filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.total, 0);
  const due = realInvoices.length
    ? realInvoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.total, 0)
    : localDue;

  return (
    <PortalShell type="Customer" active="Payments">
      <div className="app-top">
        <div>
          <span className="eyebrow">Billing setup</span>
          <h1>Payments</h1>
          <p className="section-intro">Pay approved invoices through secure Stripe Checkout. Card details stay with Stripe.</p>
        </div>
      </div>

      <div className="stats">
        <div className="card dash-card"><div className="mini-label">Verified balance</div><div className="mini-value">${profile.balance.toFixed(2)}</div></div>
        <div className="card dash-card"><div className="mini-label">Open invoices</div><div className="mini-value">${due.toFixed(2)}</div></div>
      </div>

      <section className="card profile-card" style={{ marginTop: 20 }}>
        <h2>Preferred payment source</h2>
        <div className="payment-grid">
          <button className={profile.primaryMethod === "stripe" ? "payment-option active" : "payment-option"} onClick={() => save({ primaryMethod: "stripe" })}>
            <strong>Stripe card / bank</strong>
            <small>Secure checkout opens for each approved invoice.</small>
          </button>
          <button className={profile.primaryMethod === "account_balance" ? "payment-option active" : "payment-option"} onClick={() => save({ primaryMethod: "account_balance" })}>
            <strong>Account balance</strong>
            <small>Use verified deposited funds first.</small>
          </button>
        </div>
        <label className="check-card" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={profile.automaticPayments} onChange={(event) => save({ automaticPayments: event.target.checked })} />
          Save automatic-payment preference for future recurring services
        </label>
      </section>

      {realInvoices.length > 0 && (
        <section className="card profile-card" style={{ marginTop: 20 }}>
          <h2>Pending invoices</h2>
          <div className="customer-pay-invoices">
            {realInvoices.map((invoice) => (
              <article key={invoice.id}>
                <div>
                  <strong>{invoice.number}</strong>
                  <span>{invoice.service}</span>
                  <small>{new Date(invoice.createdAt).toLocaleDateString()} - {invoice.status.replace("_", " ")}</small>
                </div>
                <b>${invoice.total.toFixed(2)}</b>
                {invoice.status === "paid"
                  ? <span className="status">Paid</span>
                  : <button className="btn btn-primary" disabled={payingId === invoice.id} onClick={() => void checkout(invoice.id)}>{payingId === invoice.id ? "Opening..." : "Pay with Stripe"}</button>}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="card profile-card" style={{ marginTop: 20 }}>
        <h2>Account balance deposits</h2>
        <p className="section-intro">Deposits are unavailable until identity checks and the payment provider are connected. The system will never create a test balance on a real account.</p>
        <button className="btn btn-outline" disabled>Deposits not yet available</button>
      </section>

      {message && <div className="payment-message" style={{ marginTop: 16 }}>{message}</div>}
    </PortalShell>
  );
}
