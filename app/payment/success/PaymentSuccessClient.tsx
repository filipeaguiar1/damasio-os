"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function PaymentSuccessClient({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<"confirming" | "confirmed" | "pending">("confirming");

  useEffect(() => {
    if (!sessionId) {
      setStatus("pending");
      return;
    }
    let active = true;
    void fetch("/api/stripe/confirm-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
      cache: "no-store",
    }).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!active) return;
      setStatus(response.ok && result.confirmed ? "confirmed" : "pending");
    }).catch(() => {
      if (active) setStatus("pending");
    });
    return () => { active = false; };
  }, [sessionId]);

  return (
    <main className="payment-result-shell success">
      <section className="payment-result-card">
        <div className="payment-result-mark">✓</div>
        <span className="payment-result-kicker">Secure checkout completed</span>
        <h1>{status === "confirmed" ? "Payment confirmed" : "Payment submitted"}</h1>
        <p>{status === "confirming"
          ? "Stripe accepted the checkout. We are confirming the payment now."
          : status === "confirmed"
            ? "Your payment is confirmed and the invoice has been updated."
            : "Stripe accepted the checkout. Automatic reconciliation is still finishing in the background."}</p>
        <div className="payment-result-note">
          <strong>{status === "confirmed" ? "All set" : "What happens next?"}</strong>
          <span>{status === "confirmed"
            ? "The invoice is Paid and the financial split has been reconciled."
            : "The signed Stripe webhook remains active as a redundant confirmation path."}</span>
        </div>
        <div className="payment-result-actions">
          <Link className="btn btn-primary" href="/customer/payments">View payment status</Link>
          <Link className="btn btn-outline" href="/customer">Customer home</Link>
        </div>
      </section>
    </main>
  );
}
