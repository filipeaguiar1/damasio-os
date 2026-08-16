"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { decideCustomerQuote } from "@/lib/services/customerQuoteService";
import type { CustomerPortalQuote } from "@/lib/repositories/customerPortalRepository";

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

export default function CustomerEstimatesPage() {
  const [quotes, setQuotes] = useState<CustomerPortalQuote[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState("");

  async function refresh() {
    try {
      const board = await loadCustomerPortal({ force: true });
      setQuotes(board.quotes);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quotes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function decide(quote: CustomerPortalQuote, approve: boolean) {
    if (["approved", "declined", "expired"].includes(quote.status)) {
      setMessage("This quote already has a final status.");
      return;
    }
    const text = approve
      ? "Approve this quote? The service company can then schedule the work. Billing will follow the agreed payment model; approval does not charge your card by itself."
      : "Decline this quote? This decision closes the quote.";
    if (!window.confirm(text)) return;

    try {
      setDecidingId(quote.id);
      setMessage("");
      const result = await decideCustomerQuote(quote.id, approve);
      setMessage(result.status === "approved"
        ? "Quote approved. Your service is ready for scheduling."
        : "Quote declined.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote decision could not be saved.");
    } finally {
      setDecidingId("");
    }
  }

  return <PortalShell type="Customer" active="Estimates">
    <div className="app-top"><div><span className="eyebrow">Customer Portal</span><h1>My Estimates</h1><p className="section-intro">Review the live quote from your service company. Approval creates the service Job; payment happens only according to the agreed billing model.</p></div></div>
    {message && <div className="notice" style={{ marginBottom: 18 }}>{message}</div>}
    <div className="estimate-list compact-estimates">
      {loading ? <div className="card profile-card"><h3>Loading estimates...</h3></div> : quotes.length === 0 ? <div className="card profile-card"><h3>No estimates yet</h3><p>Quotes connected to your account will appear here.</p></div> : quotes.map(quote => {
        const closed = ["approved", "declined", "expired"].includes(quote.status);
        return <div className="estimate-preview compact" key={quote.id}>
          <div className="estimate-compact-head"><div><span className={`estimate-status ${quote.status}`}>{quote.status}</span><h3>{quote.serviceName || "Property service"}</h3><p>{quote.quoteNumber} · {money(quote.total)}</p></div></div>
          <p className="estimate-description">{quote.notes || quote.address || "Service quote"}</p>
          {quote.status === "approved" && <div className="confirm-box"><h3>Approved</h3><p>The service can now be scheduled. Billing will appear when it becomes due.</p><div className="row"><Link className="btn btn-outline" href="/customer/invoices">View Invoices</Link><Link className="btn btn-outline" href="/customer/services">View Services</Link></div></div>}
          {quote.status === "declined" && <div className="confirm-box"><h3>Declined</h3><p>This quote is closed.</p></div>}
          {!closed && <div className="row"><button className="btn btn-primary" disabled={decidingId === quote.id} onClick={() => void decide(quote, true)}>{decidingId === quote.id ? "Saving..." : "Approve"}</button><button className="btn btn-outline" disabled={decidingId === quote.id} onClick={() => void decide(quote, false)}>Decline</button></div>}
        </div>;
      })}
    </div>
  </PortalShell>;
}
