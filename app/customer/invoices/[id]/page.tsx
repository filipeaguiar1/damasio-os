"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./invoice.module.css";

type InvoiceDetail = {
  id: string;
  number: string;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  createdAt: string;
  serviceName: string;
  cadence: "monthly" | "per_visit" | "one_time";
  periodStartsOn: string | null;
  periodEndsOn: string | null;
  dueOn: string | null;
  visit: { id: string; date: string | null; status: string | null } | null;
  company: { name: string };
  customer: { name: string; email: string | null; phone: string | null };
  property: { addressLine1: string | null; city: string | null; province: string | null; postalCode: string | null } | null;
  payment: { status: string; method: string; amount: number; paidAt: string | null; stripePaymentIntentId: string | null } | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function niceDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function CustomerInvoicePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      setLoading(true);
      setMessage("");
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sign in to view this invoice.");
        const response = await fetch(`/api/customer/invoices/${id}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Invoice could not be loaded.");
        if (active) setInvoice(result.invoice);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Invoice could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  async function pay() {
    if (!invoice || invoice.status === "paid") return;
    setPaying(true);
    setMessage("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in before paying.");
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure checkout could not be opened.");
      if (!result.url) throw new Error("Stripe did not return a secure checkout link.");
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Secure checkout could not be opened.");
      setPaying(false);
    }
  }

  const propertyAddress = invoice?.property
    ? [invoice.property.addressLine1, invoice.property.city, invoice.property.province, invoice.property.postalCode].filter(Boolean).join(", ")
    : "—";
  const paid = invoice?.status === "paid";
  const invoiceKicker = invoice?.cadence === "monthly"
    ? "Monthly service invoice"
    : invoice?.cadence === "per_visit"
      ? "Completed Visit invoice"
      : "Service invoice";
  const lineNote = invoice?.cadence === "monthly"
    ? "Monthly property maintenance plan. Individual Visits are not charged separately."
    : invoice?.cadence === "per_visit"
      ? "Charged once for this completed service Visit."
      : "Property maintenance service.";

  return (
    <PortalShell type="Customer" active="Invoices">
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <Link href="/customer/invoices">← All invoices</Link>
          <div>
            <button type="button" className={styles.secondary} onClick={() => window.print()} disabled={!invoice}>Print / Save PDF</button>
            {invoice && !paid && <button type="button" className={styles.primary} onClick={() => void pay()} disabled={paying}>{paying ? "Opening Stripe…" : "Pay securely"}</button>}
          </div>
        </div>

        {message && <div className={styles.message}>{message}</div>}
        {loading && <div className={styles.loading}>Loading secure invoice…</div>}

        {invoice && <article className={styles.invoice}>
          <header className={styles.brandHeader}>
            <div className={styles.brand}>
              <img src="/brand/4ever-seasons-logo-mark.jpg" alt="4 Ever Seasons" />
              <div><strong>4 Ever Seasons</strong><span>Property Maintenance</span></div>
            </div>
            <div className={styles.invoiceIdentity}><span>Invoice</span><strong>{invoice.number}</strong></div>
          </header>

          <section className={styles.documentIntro}>
            <div><span className={styles.kicker}>{invoiceKicker}</span><h1>{invoice.serviceName}</h1><p>Issued {niceDate(invoice.createdAt)}{invoice.dueOn ? ` · Due ${niceDate(invoice.dueOn)}` : ""}</p></div>
            <span className={`${styles.status} ${paid ? styles.paid : ""}`}>{statusLabel(invoice.status)}</span>
          </section>

          <section className={styles.parties}>
            <div><span>Service provider</span><strong>{invoice.company.name}</strong><p>Powered by 4 Ever Seasons</p></div>
            <div><span>Bill to</span><strong>{invoice.customer.name}</strong><p>{invoice.customer.email || "Customer account"}</p></div>
            <div><span>Service property</span><strong>{invoice.property?.addressLine1 || "Property"}</strong><p>{propertyAddress}</p></div>
          </section>

          {invoice.cadence === "monthly" && <section className={styles.period}>
            <div><span>Billing cadence</span><strong>Monthly</strong></div>
            <div><span>Service period</span><strong>{niceDate(invoice.periodStartsOn)} – {niceDate(invoice.periodEndsOn)}</strong></div>
            <div><span>Customer charge</span><strong>One invoice for this month</strong></div>
          </section>}

          {invoice.cadence === "per_visit" && <section className={styles.period}>
            <div><span>Billing cadence</span><strong>Per completed Visit</strong></div>
            <div><span>Service date</span><strong>{niceDate(invoice.visit?.date)}</strong></div>
            <div><span>Customer charge</span><strong>One charge for this Visit</strong></div>
          </section>}

          <section className={styles.lineItems}>
            <div className={styles.lineHeader}><span>Description</span><span>Amount</span></div>
            <div className={styles.line}><div><strong>{invoice.serviceName}</strong><small>{lineNote}</small></div><strong>{money(invoice.subtotal)}</strong></div>
          </section>

          <section className={styles.totals}>
            <div><span>Subtotal</span><strong>{money(invoice.subtotal)}</strong></div>
            <div><span>Tax</span><strong>{money(invoice.tax)}</strong></div>
            <div className={styles.grand}><span>Total CAD</span><strong>{money(invoice.total)}</strong></div>
          </section>

          {invoice.payment && <section className={styles.paymentBox}>
            <div><span>Payment status</span><strong>{statusLabel(invoice.payment.status)}</strong></div>
            <div><span>Method</span><strong>{statusLabel(invoice.payment.method)}</strong></div>
            <div><span>Paid on</span><strong>{niceDate(invoice.payment.paidAt)}</strong></div>
          </section>}

          <footer className={styles.footer}>
            <div><strong>Thank you for choosing 4 Ever Seasons.</strong><p>Your invoice, payment and service history stay connected to your secure customer account.</p></div>
            <span>4EverSeasons.com</span>
          </footer>
        </article>}
      </div>
    </PortalShell>
  );
}
