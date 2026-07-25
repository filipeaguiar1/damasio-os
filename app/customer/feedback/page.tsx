"use client";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { addCustomerFeedback, addCustomerServiceRequest, loadCustomerPortal } from "@/lib/services/customerPortalService";
import { useCustomerTips } from "@/lib/hooks/useCustomerTips";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import type { CustomerPortalBoard, CustomerPortalVisit } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
const tipOptions = [5, 10, 20];
function dateLabel(date?: string | null) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Date not recorded"; }

export default function FeedbackPage() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [selected, setSelected] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [message, setMessage] = useState("");
  const tips = useCustomerTips();
  const wallet = useCustomerWallet();
  const completed = useMemo(() => board.visits.filter((v) => v.status === "completed"), [board.visits]);
  const waiting = completed.filter((v) => !board.feedback.some((f) => f.visitId === v.id));
  const current: CustomerPortalVisit | null = completed.find((v) => v.id === selected) || waiting[0] || completed[0] || null;
  const tip = Number(tipAmount);
  const validTip = Number.isFinite(tip) && tip >= 1 && tip <= 500;
  useEffect(() => { loadCustomerPortal().then(setBoard).catch((e) => setMessage(e.message)); }, []);

  async function submit() {
    if (!current) { setMessage("No completed service waiting for feedback."); return; }
    try { const updated = await addCustomerFeedback({ visitId: current.id, rating, comment }); setBoard(updated); setComment(""); setSelected(current.id); setMessage("Feedback saved. You may now leave an optional tip below."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Feedback failed."); }
  }

  async function payWalletTip() {
    if (!current || !validTip) return;
    const balance = await tips.sendWalletTip(tip, `Tip for ${current.serviceName} visit ${current.id}`);
    if (balance !== null) await wallet.reload();
  }

  function payCardTip() {
    if (!current || !validTip) return;
    void tips.sendTip(tip, `Tip for ${current.serviceName} visit ${current.id}`);
  }

  async function requestReturnVisit() {
    if (!current) { setMessage("Choose a completed service first."); return; }
    try { const updated = await addCustomerServiceRequest({ serviceName: "Return Visit", message: comment || `Return visit requested for ${current.serviceName} at ${current.address || "property"}.` }); setBoard(updated); setMessage("Return visit requested. Admin will review it."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Request failed."); }
  }
  function everythingOk() { setMessage("Thank you. This visit was marked as OK by the customer."); }
  const visibleMessage = message || tips.message || wallet.message;

  return <PortalShell type="Customer" active="Feedback">
    <div className="neo-hero customer-hero"><div><span className="eyebrow">Feedback Center · Supabase</span><h1>Review completed services</h1><p>Review the completed service and optionally thank the team using wallet credits or a card.</p></div></div>
    {visibleMessage && <div className="notice" style={{ marginBottom: 18 }}>{visibleMessage}</div>}
    {!current ? <div className="card profile-card"><h2>No completed service yet</h2><p>When a crew completes a service, it will appear here.</p></div> : <div className="feedback-clean-layout"><aside className="card feedback-service-list"><div className="table-head"><div><h2>Services</h2><p className="section-intro">Select a completed visit.</p></div><span className="pill">{waiting.length} pending</span></div><div className="feedback-list-stack">{completed.map((v) => { const done = board.feedback.some((f) => f.visitId === v.id); return <button key={v.id} className={current.id === v.id ? "feedback-list-item active" : "feedback-list-item"} onClick={() => { setSelected(v.id); setMessage(""); setTipAmount(""); }}><span className={done ? "review-mark done" : "review-mark"}>{done ? "✓" : ""}</span><span><strong>{v.serviceName}</strong><small>{v.address}</small><small>{dateLabel(v.scheduledDate)}</small></span></button>; })}</div></aside><section className="card profile-card feedback-panel"><div className="table-head"><div><span className="eyebrow">Selected service</span><h2>{current.serviceName}</h2><p><strong>{current.address}</strong></p></div></div><div className="detail-grid"><div className="detail-box"><div className="detail-label">Date</div><div className="detail-value">{dateLabel(current.scheduledDate)}</div></div><div className="detail-box"><div className="detail-label">Done by</div><div className="detail-value">{current.crewName || "Crew"}</div></div><div className="detail-box"><div className="detail-label">Status</div><div className="detail-value">{current.status}</div></div></div><h2>Your feedback</h2><div className="field"><label>Rating</label><div className="star-row">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={n <= rating ? "star-button active" : "star-button"} onClick={() => setRating(n)}>★</button>)}</div></div><div className="field"><label>Comment</label><textarea className="input" style={{ minHeight: 110 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything we should know?" /></div><div className="row wrap"><button className="btn btn-primary" onClick={submit}>Submit Review</button><button className="btn btn-outline" onClick={requestReturnVisit}>Request Return Visit</button><button className="btn btn-outline" onClick={everythingOk}>Everything OK</button></div><div className="billing-panel" style={{ marginTop: 24 }}><header><div><span className="billing-kicker">Optional tip</span><h2>Thank the service team</h2><p>Use your wallet balance or pay directly by card.</p></div></header><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{tipOptions.map((amount) => <button key={amount} className={tip === amount ? "btn btn-primary" : "btn btn-outline"} type="button" onClick={() => setTipAmount(String(amount))}>${amount}</button>)}<input aria-label="Custom tip amount" type="number" min={1} max={500} step="0.01" placeholder="Custom" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} style={{ width: 120 }} /></div><div className="row wrap" style={{ marginTop: 12 }}><button className="btn btn-outline" type="button" disabled={!validTip || tips.payingWallet || wallet.balanceCredits < tip} onClick={() => void payWalletTip()}>{tips.payingWallet ? "Paying..." : `Use balance (${wallet.balanceCredits.toFixed(0)} credits)`}</button><button className="btn btn-primary" type="button" disabled={!validTip || tips.opening} onClick={payCardTip}>{tips.opening ? "Opening Stripe..." : "Pay directly by card"}</button></div></div></section></div>}
  </PortalShell>;
}
