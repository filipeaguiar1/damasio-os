"use client";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { addCustomerFeedback, addCustomerServiceRequest, loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard, CustomerPortalVisit } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
function dateLabel(date?: string | null) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Date not recorded"; }

export default function FeedbackPage() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [selected, setSelected] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const completed = useMemo(() => board.visits.filter((v) => v.status === "completed"), [board.visits]);
  const waiting = completed.filter((v) => !board.feedback.some((f) => f.visitId === v.id));
  const current: CustomerPortalVisit | null = completed.find((v) => v.id === selected) || waiting[0] || completed[0] || null;
  useEffect(() => { loadCustomerPortal().then(setBoard).catch((e) => setMessage(e.message)); }, []);
  async function submit() {
    if (!current) { setMessage("No completed service waiting for feedback."); return; }
    try { const updated = await addCustomerFeedback({ visitId: current.id, rating, comment }); setBoard(updated); setComment(""); setSelected(current.id); setMessage("Feedback saved."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Feedback failed."); }
  }
  async function requestReturnVisit() {
    if (!current) { setMessage("Choose a completed service first."); return; }
    try { const updated = await addCustomerServiceRequest({ serviceName: "Return Visit", message: comment || `Return visit requested for ${current.serviceName} at ${current.address || "property"}.` }); setBoard(updated); setMessage("Return visit requested. Admin will review it."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Request failed."); }
  }
  function everythingOk() { setMessage("Thank you. This visit was marked as OK by the customer."); }
  return <PortalShell type="Customer" active="Feedback">
    <div className="neo-hero customer-hero"><div><span className="eyebrow">Feedback Center · Supabase</span><h1>Review completed services</h1><p>Low ratings with comments automatically create a Return Visit task for Admin confirmation.</p></div></div>
    {message && <div className="notice" style={{ marginBottom: 18 }}>{message}</div>}
    {!current ? <div className="card profile-card"><h2>No completed service yet</h2><p>When a crew completes a service, it will appear here.</p></div> : <div className="feedback-clean-layout"><aside className="card feedback-service-list"><div className="table-head"><div><h2>Services</h2><p className="section-intro">Select a completed visit.</p></div><span className="pill">{waiting.length} pending</span></div><div className="feedback-list-stack">{completed.map((v) => { const done = board.feedback.some((f) => f.visitId === v.id); return <button key={v.id} className={current.id === v.id ? "feedback-list-item active" : "feedback-list-item"} onClick={() => { setSelected(v.id); setMessage(""); }}><span className={done ? "review-mark done" : "review-mark"}>{done ? "✓" : ""}</span><span><strong>{v.serviceName}</strong><small>{v.address}</small><small>{dateLabel(v.scheduledDate)}</small></span></button>; })}</div></aside><section className="card profile-card feedback-panel"><div className="table-head"><div><span className="eyebrow">Selected service</span><h2>{current.serviceName}</h2><p><strong>{current.address}</strong></p></div></div><div className="detail-grid"><div className="detail-box"><div className="detail-label">Date</div><div className="detail-value">{dateLabel(current.scheduledDate)}</div></div><div className="detail-box"><div className="detail-label">Done by</div><div className="detail-value">{current.crewName || "Crew"}</div></div><div className="detail-box"><div className="detail-label">Status</div><div className="detail-value">{current.status}</div></div></div><h2>Your feedback</h2><div className="field"><label>Rating</label><div className="star-row">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={n <= rating ? "star-button active" : "star-button"} onClick={() => setRating(n)}>★</button>)}</div></div><div className="field"><label>Comment</label><textarea className="input" style={{ minHeight: 110 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything we should know?" /></div><div className="row wrap"><button className="btn btn-primary" onClick={submit}>Submit Review</button><button className="btn btn-outline" onClick={requestReturnVisit}>Request Return Visit</button><button className="btn btn-outline" onClick={everythingOk}>Everything OK</button></div></section></div>}
  </PortalShell>;
}
