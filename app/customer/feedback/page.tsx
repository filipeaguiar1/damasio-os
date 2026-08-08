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
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "Date not recorded";
}

export default function FeedbackPage() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [selected, setSelected] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [tipMethod, setTipMethod] = useState<TipMethod>("account_balance");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const tips = useCustomerTips();
  const wallet = useCustomerWallet();

  const completed = useMemo(() => board.visits.filter((visit) => visit.status === "completed"), [board.visits]);
  const waiting = useMemo(() => completed.filter((visit) => !board.feedback.some((feedback) => feedback.visitId === visit.id)), [board.feedback, completed]);
  const current: CustomerPortalVisit | null = completed.find((visit) => visit.id === selected) || waiting[0] || completed[0] || null;
  const currentDone = Boolean(current && board.feedback.some((feedback) => feedback.visitId === current.id));
  const tip = Number(tipAmount);
  const validTip = Number.isFinite(tip) && tip >= 1 && tip <= 500;
  const insufficientBalance = tipMethod === "account_balance" && validTip && wallet.balanceCredits < tip;

  useEffect(() => {
    loadCustomerPortal({ force: true })
      .then(setBoard)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Feedback could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  function openVisit(visit: CustomerPortalVisit) {
    setSelected(visit.id);
    setRating(5);
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
    try {
      const updated = await addCustomerFeedback({ visitId: current.id, rating, comment });
      setBoard(updated);
      setMessage("Feedback saved. Thank you for reviewing your service.");
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
      <div><span>YOUR EXPERIENCE</span><h1>Review completed services</h1><p>Open a completed visit, tell us how it went, and optionally thank the crew with a tip.</p></div>
      <div className="feedback-hero-count"><strong>{waiting.length}</strong><span>waiting for feedback</span></div>
    </div>

    {visibleMessage && <div className="feedback-status-message notice" role="status">{visibleMessage}</div>}

    {loading ? <div className="feedback-empty-state"><i>…</i><h2>Loading completed services</h2></div> : !current ? <div className="feedback-empty-state"><i>✓</i><h2>No completed service yet</h2><p>When a crew completes a service, it will appear here.</p></div> : <div className="feedback-experience-layout">
      <aside className="feedback-visit-list">
        <header><div><span>COMPLETED VISITS</span><h2>Choose a service</h2></div><b>{waiting.length} pending</b></header>
        <div>{completed.map((visit) => {
          const done = board.feedback.some((feedback) => feedback.visitId === visit.id);
          return <button key={visit.id} type="button" className={current.id === visit.id ? "active" : ""} onClick={() => openVisit(visit)}>
            <i className={done ? "done" : ""}>{done ? "✓" : "★"}</i>
            <span><strong>{visit.serviceName}</strong><small>{visit.address || "Property"}</small><small>{dateLabel(visit.scheduledDate)}</small></span>
            <em>{done ? "Reviewed" : "Review"}</em>
          </button>;
        })}</div>
      </aside>

      <section className="feedback-review-card">
        <header className="feedback-service-head">
          <div><span>SERVICE COMPLETED</span><h2>{current.serviceName}</h2><p>{current.address || "Property"}</p></div>
          <div><strong>{dateLabel(current.scheduledDate)}</strong><small>{current.crewName || "Service crew"}</small></div>
        </header>

        <section className="feedback-question-card">
          <span>HOW DID IT GO?</span>
          <h2>Did you like the service?</h2>
          <div className="feedback-sentiment-grid">
            <button type="button" className={rating >= 4 ? "active" : ""} onClick={() => setRating(5)}><i>✓</i><strong>Yes, I liked it</strong><small>Everything looked great</small></button>
            <button type="button" className={rating < 4 ? "active issue" : ""} onClick={() => setRating(2)}><i>!</i><strong>It needs attention</strong><small>Tell us what happened</small></button>
          </div>
          <div className="feedback-rating-row" aria-label="Service rating">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={`star-button ${value <= rating ? "active" : ""}`.trim()} onClick={() => setRating(value)} aria-label={`${value} star${value === 1 ? "" : "s"}`}>★</button>)}</div>
          <label className="feedback-comment-field"><span>Comment <small>optional</small></span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell us what the crew did well or what needs attention." /></label>
          <div className="feedback-review-actions">
            <button className="feedback-primary-action" type="button" onClick={() => void submit()}>{currentDone ? "Update Review" : "Submit Review"}</button>
            <button className="feedback-secondary-action" type="button" onClick={() => void requestReturnVisit()}>Request Return Visit</button>
          </div>
        </section>

        <section className="feedback-tip-card">
          <header><div><span>OPTIONAL TIP</span><h2>Thank the service team</h2><p>No tip is required. Choose an amount only when you want to.</p></div><i>♥</i></header>
          <div className="feedback-tip-options">{tipOptions.map((amount) => <button key={amount} type="button" className={tip === amount ? "active" : ""} onClick={() => setTipAmount(String(amount))}><strong>${amount}</strong><small>CAD</small></button>)}</div>
          <label className="feedback-custom-tip"><span>Custom amount</span><div><b>$</b><input aria-label="Custom tip amount" type="number" min={1} max={500} step="0.01" placeholder="Enter amount" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} /></div></label>

          <div className="feedback-payment-methods">
            <button type="button" className={tipMethod === "account_balance" ? "active" : ""} onClick={() => setTipMethod("account_balance")}>
              <i>$</i><span><strong>Account balance</strong><small>{wallet.loading ? "Loading balance…" : `$${wallet.balanceCredits.toFixed(2)} available`}</small></span><b>{tipMethod === "account_balance" ? "✓" : ""}</b>
            </button>
            <button type="button" className={tipMethod === "stripe" ? "active" : ""} onClick={() => setTipMethod("stripe")}>
              <i>▣</i><span><strong>Card with Stripe</strong><small>Secure checkout</small></span><b>{tipMethod === "stripe" ? "✓" : ""}</b>
            </button>
          </div>

          {insufficientBalance && <div className="feedback-balance-warning"><div><strong>Not enough account balance</strong><span>Add funds or select Stripe to continue.</span></div><Link href="/mobile/customer/payments">Add funds</Link></div>}

          <button className="feedback-tip-submit" type="button" disabled={!validTip || tips.opening || tips.payingWallet || insufficientBalance} onClick={() => void payTip()}>
            {tips.opening ? "Opening Stripe…" : tips.payingWallet ? "Sending tip…" : validTip ? `Send $${tip.toFixed(2)} tip` : "Choose a tip amount"}
          </button>
        </section>
      </section>
    </div>}
  </PortalShell>;
}
