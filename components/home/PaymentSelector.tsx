"use client";

import { useState } from "react";
import type { PaymentMethod } from "@/lib/storage";

type Props = {
  leadId: string | null;
  amount: number;
  customerEmail: string;
  customerName: string;
  onSelected: (method: PaymentMethod, note: string) => void;
};

const methodCopy: Record<PaymentMethod, { title: string; text: string; note: string }> = {
  credit_card: {
    title: "Credit / Debit Card",
    text: "Pay securely online by card. Stripe checkout will open when Stripe keys are configured.",
    note: "Card checkout selected"
  },
  etransfer: {
    title: "Interac e-Transfer",
    text: "Send an Interac e-Transfer after submitting the quote. We will match it with your name and address.",
    note: "Waiting for Interac e-Transfer"
  },
  cash_visit: {
    title: "Pay at the Visit",
    text: "Pay by cash when the team arrives for the service.",
    note: "Customer will pay at the visit"
  },
  cheque_visit: {
    title: "Pay by Cheque",
    text: "Pay by cheque when the team arrives for the service.",
    note: "Customer will pay by cheque"
  },
  other: {
    title: "Other Payment Method",
    text: "Another payment method will be arranged directly with the customer.",
    note: "Other payment method"
  }
};

export function PaymentSelector({
  leadId,
  amount,
  customerEmail,
  customerName,
  onSelected
}: Props) {
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function choose(method: PaymentMethod) {
    setSelected(method);
    setMessage("");
    onSelected(method, methodCopy[method].note);

    if (method !== "credit_card") {
      setMessage(methodCopy[method].text);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          leadId,
          amount,
          customerEmail,
          customerName
        })
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setMessage(
        data.message ??
          "Stripe is not configured yet. Add STRIPE_SECRET_KEY and NEXT_PUBLIC_SITE_URL."
      );
    } catch {
      setMessage("Could not start card checkout. Check Stripe configuration.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="payment-box">
      <div className="payment-grid">
        {(Object.keys(methodCopy) as PaymentMethod[]).map((method) => (
          <button
            key={method}
            className={selected === method ? "payment-option active" : "payment-option"}
            onClick={() => choose(method)}
            disabled={loading}
          >
            <strong>{methodCopy[method].title}</strong>
            <small>{methodCopy[method].text}</small>
          </button>
        ))}
      </div>

      {message && <div className="payment-message">{message}</div>}
    </div>
  );
}