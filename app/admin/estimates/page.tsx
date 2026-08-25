"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getCustomerPropertyDirectory } from "@/lib/services/customerPropertyService";
import type { CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { addQuoteToProperty, approveQuoteAndInvite, changeQuoteStatus, loadOperationsBoard } from "@/lib/services/operationsService";
import type { OperationQuote, OperationsBoard } from "@/lib/repositories/operationsRepository";

const emptyBoard: OperationsBoard = { quotes: [], jobs: [], tasks: [], activity: [] };

function HstTag() {
  return <small style={{ fontSize: "0.72em", opacity: 0.68, marginLeft: 5, fontWeight: 600 }}>+ HST</small>;
}

export default function EstimatesPage() {
  const [board, setBoard] = useState<OperationsBoard>(emptyBoard);
  const [directory, setDirectory] = useState<CustomerPropertyRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [serviceName, setServiceName] = useState("Weekly Lawn Care");
  const [subtotal, setSubtotal] = useState("120");
  const [message, setMessage] = useState("Loading real quotes...");
  const [loading, setLoading] = useState(true);
  const [sendingQuoteId, setSendingQuoteId] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [nextBoard, nextDirectory] = await Promise.all([loadOperationsBoard({ force: true }), getCustomerPropertyDirectory()]);
      setBoard(nextBoard);
      setDirectory(nextDirectory);
      if (!selected && nextDirectory[0]) setSelected(nextDirectory[0].propertyId);
      setMessage("Quotes connected to Supabase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load quotes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(() => directory.find((item) => item.propertyId === selected) || directory[0] || null, [directory, selected]);
  const total = board.quotes.reduce((sum, quote) => sum + Number(quote.subtotal || 0), 0);
  const approved = board.quotes.filter((quote) => quote.status === "approved").length;
  const draftOrSent = board.quotes.filter((quote) => quote.status === "draft" || quote.status === "sent").length;

  async function createQuote() {
    if (!current) return setMessage("Create a customer/property first.");
    try {
      const next = await addQuoteToProperty({ customerId: current.customerId, propertyId: current.propertyId, serviceName, subtotal: Number(subtotal || 0), notes: serviceName });
      setBoard(next);
      setMessage("Quote saved. HST is calculated separately and added when billed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote was not saved.");
    }
  }

  async function setQuoteStatus(quote: OperationQuote, status: OperationQuote["status"]) {
    try {
      if (status === "sent") {
        setSendingQuoteId(quote.id);
        setMessage(`Sending ${quote.quoteNumber} and preparing customer access…`);
        const result = await approveQuoteAndInvite({ quoteId: quote.id, finalTotal: Number(quote.total || 0), sendInvite: true });
        await refresh();
        setMessage(result.message);
        return;
      }
      const next = await changeQuoteStatus(quote.id, status);
      setBoard(next);
      setMessage(status === "approved" ? "Quote approved. Job and workflow tasks created." : "Quote status updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote was not updated.");
    } finally {
      setSendingQuoteId("");
    }
  }

  return (
    <AdminShell active="Estimates">
      <div className="app-top"><div><span className="eyebrow">V42.3 Real Quotes</span><h1>Quotes Workflow</h1><p className="section-intro">Create company quotes using the service price before tax. Ontario HST is added separately.</p></div><div className="row"><button className="btn btn-outline" onClick={() => void refresh()} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button><Link className="btn btn-primary" href="/admin/operations">Operations</Link></div></div>

      <div className="stats"><div className="card dash-card"><div className="mini-label">Quotes</div><div className="mini-value">{board.quotes.length}</div></div><div className="card dash-card"><div className="mini-label">Pipeline Value</div><div className="mini-value">${total.toFixed(0)}<HstTag /></div></div><div className="card dash-card"><div className="mini-label">Approved</div><div className="mini-value">{approved}</div></div><div className="card dash-card"><div className="mini-label">Draft/Sent</div><div className="mini-value">{draftOrSent}</div></div></div>

      <section className="card" style={{ marginTop: 20 }}><h2>Create Quote</h2><p className="section-intro">{message}</p><div className="grid-3"><div className="field"><label>Property</label><select className="input" value={selected} onChange={(event) => setSelected(event.target.value)}>{directory.map((item) => <option key={item.propertyId} value={item.propertyId}>{item.fullName} — {item.addressLine1}</option>)}</select></div><div className="field"><label>Service</label><input className="input" value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></div><div className="field"><label>Service price <span style={{ opacity: 0.65, fontWeight: 500 }}>(before HST)</span></label><input className="input" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} /></div></div><button className="btn btn-primary" onClick={() => void createQuote()}>Save Quote</button></section>

      <section className="card table-card" style={{ marginTop: 20 }}><div className="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Project</th><th>Price</th><th>Status</th><th>Customer access</th></tr></thead><tbody>{board.quotes.length === 0 ? <tr><td colSpan={6}>No quotes yet.</td></tr> : board.quotes.map((quote) => <tr key={quote.id}><td><strong>{quote.quoteNumber}</strong><br/><small>{new Date(quote.createdAt).toLocaleDateString()}</small></td><td>{quote.customerName}<br/><small>{quote.address}</small></td><td>{quote.serviceName}</td><td><strong>${Number(quote.subtotal || 0).toFixed(2)}</strong><HstTag /></td><td><select className="input" value={quote.status} disabled={sendingQuoteId === quote.id} onChange={(event) => void setQuoteStatus(quote, event.target.value as OperationQuote["status"])}><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="expired">Expired</option></select></td><td>{sendingQuoteId === quote.id ? "Sending invitation…" : quote.status === "sent" ? "Quote sent / portal access prepared" : quote.status === "approved" ? "Approved workflow active" : "Select Sent to email the customer"}</td></tr>)}</tbody></table></div></section>
    </AdminShell>
  );
}
