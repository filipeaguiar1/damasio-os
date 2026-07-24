"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function CancelCheckoutClient({ invoiceId }: { invoiceId: string }) {
  const [message, setMessage] = useState("Restoring your invoice so you can try again...");

  useEffect(() => {
    if (!invoiceId) {
      setMessage("No payment was taken.");
      return;
    }
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMessage("No payment was taken. Sign in again to retry this invoice.");
        return;
      }
      const response = await fetch("/api/stripe/checkout", {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId })
      });
      const result = await response.json();
      setMessage(response.ok
        ? "No payment was taken. Your invoice is ready to try again."
        : result.error || "No payment was taken. Return to Payments to try again.");
    })();
  }, [invoiceId]);

  return (
    <main className="section section-white">
      <div className="container">
        <div className="card profile-card">
          <span className="eyebrow">Payment</span>
          <h1>Payment cancelled</h1>
          <p className="section-intro">{message}</p>
          <Link className="btn btn-primary" href="/customer/payments">Back to payments</Link>
        </div>
      </div>
    </main>
  );
}
