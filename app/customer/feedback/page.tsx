"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { addCustomerFeedback, addCustomerServiceRequest, loadCustomerPortal } from "@/lib/services/customerPortalService";
import { useCustomerTips } from "@/lib/hooks/useCustomerTips";
import { useCustomerWallet } from "@/lib/hooks/useCustomerWallet";
import type { CustomerPortalBoard, CustomerPortalVisit } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
const tipOptions = [5, 10, 15, 20];
type TipMethod = "account_balance" | "stripe";

function dateLabel(date?: string | null) {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "Date not recorded";
}

export default function FeedbackPage() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [selected, setSelected] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [tipMethod, setTipMethod] = useState<TipMethod>("account_balance");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const tips = useCustomerTips();
  const wallet = useCustomerWallet();

  const completed = useMemo(() => board.visits.filter((visit) => visit.status === "completed"), [board.visits]);
  const waiting = useMemo(() => completed.filter((visit) => !board.feedback.some((feedback) => feedback.visitId === visit.id)), [board.feedback, completed]);
  const current: CustomerPortalVisit | null = completed.find((visit) => visit.id === selected) || null;
  const currentDone = Boolean(current && board.feedback.some((feedback) => feedback.visitId === current.id));
  const tip = Number(tipAmount);
  const validTip = Number.isFinite(tip) && tip >= 1 && tip <= 500;
  const insufficientBalance = tipMethod === "account_balance" && validTip && wallet.balanceCredits < tip;

  useEffect(() => {
    loadCustomerPortal()
      .then(setBoard)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Feedback could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  function toggleVisit(visit: CustomerPortalVisit) {
    if (selected === visit.id) {
      setSelected("");
      setMessage("");
      return;
    }
    setSelected(visit.id);
    setRating(0);
    setComment("");
    setTipAmount("");
    setTipMethod("account_balance");
    setMessage("");
    tips.clearMessage();
  }

  async function submit() {
    if (!current) {
      setMessage("Choose a completed service first.");
      return;
    }
    if (rating !== 5 && rating !== 2) {
      setMessage("Choose like or dislike before submitting your review.");
      return;
    }
    try {
      const updated = await addCustomerFeedback({ visitId: current.id, rating, comment });
      setBoard(updated);
      setMessage("Feedback saved. Thank you for reviewing your service.");
      setSelected("");
      setRating(0);
      setComment("");
      setTipAmount("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Feedback failed.");
    }
  }

  async function payTip() {
    if (!current || !validTip) {
      setMessage("Choose a tip between $1 and $500.");
      return;
    }
    const note = `Tip for ${current.serviceName} visit ${current.id}`;
    if (tipMethod === "account_balance") {
      if (wallet.balanceCredits < tip) {
        setMessage("Your account balance is too low. Add funds or pay securely with Stripe.");
        return;
      }
      const balance = await tips.sendWalletTip(tip, note);
      if (balance !== null) await wallet.reload();
      return;
    }
    void tips.sendTip(tip, note, "/customer/feedback");
  }

  async function requestReturnVisit() {
    if (!current) {
      setMessage("Choose a completed service first.");
      return;
    }
    try {
      const updated = await addCustomerServiceRequest({
        serviceName: "Return Visit",
        message: comment || `Return visit requested for ${current.serviceName} at ${current.address || "property"}.`,
      });
      setBoard(updated);
      setMessage("Return visit requested. Admin will review it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    }
  }

  const visibleMessage = message || tips.message || wallet.message;

  return <PortalShell type="Customer" active="Feedback">
    <div className="feedback-experience-hero">
      <div><span>YOUR EXPERIENCE</span><h1>Review completed services</h1><p>Pending services appear in red. Completed reviews appear in green.</p></div>
      <div className="feedback-hero-count"><strong>{waiting.length}</strong><span>waiting for feedback</span></div>
    </div>

    {visibleMessage && <div className="feedback-status-message notice" role="status">{visibleMessage}</div>}

    {loading ? <div className="feedback-empty-state"><i>…</i><h2>Loading completed services</h2></div> : completed.length === 0 ? <div className="feedback-empty-state"><i>✓</i><h2>No completed service yet</h2><p>When a crew completes a service, it will appear here.</p></div> : <div className="feedback-experience-layout">
      <aside className="feedback-visit-list">
        <header><div><span>COMPLETED VISITS</span><h2>Service history</h2></div><b>{waiting.length} pending</b></header>
        <div style={{ display: "grid", gap: 9 }}>{completed.map((visit) => {
          const done = board.feedback.some((feedback) => feedback.visitId === visit.id);
          const open = selected === visit.id;
          const tone = done ? { background: "#f0fdf4", border: "#86efac", color: "#166534" } : { background: "#fff1f2", border: "#fda4af", color: "#9f1239" };
          return <button key={visit.id} type="button" aria-expanded={open} onClick={() => toggleVisit(visit)} style={{ width: "100%", display: "grid", gridTemplateColumns: "36px minmax(0,1fr) 32px", gap: 11, alignItems: "center", textAlign: "left", padding: "12px 13px", borderRadius: 15, border: `1px solid ${tone.border}`, background: open ? "#fff" : tone.background, boxShadow: open ? "0 10px 26px rgba(15,23,42,.08)" : "none" }}>
            <i style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: done ? "#dcfce7" : "#ffe4e6", color: tone.color, fontStyle: "normal", fontWeight: 900 }}>{done ? "✓" : "!"}</i>
            <span><strong style={{ display: "block", color: "#0f172a" }}>{visit.serviceName}</strong><small style={{ display: "block", marginTop: 2, color: "#64748b" }}>{dateLabel(visit.scheduledDate)} · {visit.address || "Property"}</small><small style={{ display: "block", marginTop: 4, color: tone.color, fontWeight: 800 }}>{done ? "Feedback completed" : "Feedback pending"}</small></span>
            <b aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: done ? "#dcfce7" : "#ffe4e6", color: tone.color, fontSize: 16, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s ease" }}>⌄</b>
          </button>;
        })}</div>
      </aside>

      {!current ? <section className="feedback-review-card" style={{ minHeight: 170, display: "grid", placeItems: "center", textAlign: "center", padding: 26 }}>
        <div><div style={{ width: 42, height: 42, borderRadius: 14, display: "grid", placeItems: "center", margin: "0 auto 10px", background: "#f1f5f9", color: "#475569", fontSize: 18 }}>⌄</div><h2 style={{ margin: 0 }}>Choose a service</h2><p style={{ margin: "7px 0 0", color: "#64748b" }}>Tap the small control to open a review.</p></div>
      </section> : <section className="feedback-review-card">
        <header className="feedback-service-head">
          <div><span>{currentDone ? "FEEDBACK COMPLETED" : "FEEDBACK PENDING"}</span><h2>{current.serviceName}</h2><p>{current.address || "Property"}</p></div>
          <div><strong>{dateLabel(current.scheduledDate)}</strong><small>{current.crewName || "Service crew"}</small></div>
        </header>

        <section className="feedback-question-card">
          <span>HOW DID IT GO?</span>
          <h2>Did you like the service?</h2>
          <div className="feedback-sentiment-grid">
            <button type="button" className={rating === 5 ? "active" : ""} onClick={() => setRating(5)}><i>👍</i><strong>Like</strong><small>I liked the service</small></button>
            <button type="button" className={rating === 2 ? "active issue" : ""} onClick={() => setRating(2)}><i>👎</i><strong>Dislike</strong><small>It needs attention</small></button>
          </div>
          <label className="feedback-comment-field"><span>Comment <small>optional</small></span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell us what went well or what needs attention." /></label>
          <div className="feedback-review-actions">
            <button className="feedback-primary-action" type="button" disabled={rating === 0} onClick={() => void submit()}>{currentDone ? "Update Review" : "Submit Review"}</button>
            <button className="feedback-secondary-action" type="button" onClick={() => void requestReturnVisit()}>Request Return Visit</button>
          </div>
        </section>

        <section className="feedback-tip-card">
          <header><div><span>OPTIONAL TIP</span><h2>Thank the service team</h2><p>No tip is required. Choose an amount only when you want to.</p></div><i>♥</i></header>
          <div className="feedback-tip-options">{tipOptions.map((amount) => <button key={amount} type="button" className={tip === amount ? "active" : ""} onClick={() => setTipAmount(String(amount))}><strong>${amount}</strong><small>CAD</small></button>)}</div>
          <label className="feedback-custom-tip"><span>Custom amount</span><div><b>$</b><input aria-label="Custom tip amount" type="number" min={1} max={500} step="0.01" placeholder="Enter amount" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} /></div></label>

          <div className="feedback-payment-methods">
            <button type="button" className={tipMethod === "account_balance" ? "active" : ""} onClick={() => setTipMethod("account_balance")}><i>$</i><span><strong>Account balance</strong><small>{wallet.loading ? "Loading balance…" : `$${wallet.balanceCredits.toFixed(2)} available`}</small></span><b>{tipMethod === "account_balance" ? "✓" : ""}</b></button>
            <button type="button" className={tipMethod === "stripe" ? "active" : ""} onClick={() => setTipMethod("stripe")}><i>▣</i><span><strong>Card with Stripe</strong><small>Secure checkout</small></span><b>{tipMethod === "stripe" ? "✓" : ""}</b></button>
          </div>

          {insufficientBalance && <div className="feedback-balance-warning"><div><strong>Not enough account balance</strong><span>Add funds or select Stripe to continue.</span></div><Link href="/mobile/customer/payments">Add funds</Link></div>}
          <button className="feedback-tip-submit" type="button" disabled={!validTip || tips.opening || tips.payingWallet || insufficientBalance} onClick={() => void payTip()}>{tips.opening ? "Opening Stripe…" : tips.payingWallet ? "Sending tip…" : validTip ? `Send $${tip.toFixed(2)} tip` : "Choose a tip amount"}</button>
        </section>
      </section>}
    </div>}
  </PortalShell>;
}
