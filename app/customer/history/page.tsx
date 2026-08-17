"use client";

import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { CustomerServiceVisitModal } from "@/components/customer/CustomerServiceVisitModal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { getPropertyPhotoHistory, type PropertyPhotoHistory } from "@/lib/services/propertyPhotoService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = {
  property: null,
  visits: [],
  tasks: [],
  requests: [],
  quotes: [],
  feedback: [],
};

function niceDate(value?: string | null) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    : "Date recorded";
}

export default function CustomerHistory() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [photoHistory, setPhotoHistory] = useState<PropertyPhotoHistory | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [openTaskId, setOpenTaskId] = useState("");
  const [disputeVisitId, setDisputeVisitId] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeMessage, setDisputeMessage] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCustomerPortal()
      .then(setBoard)
      .catch((event) => setError(event.message));
  }, []);

  useEffect(() => {
    const propertyId = board.property?.propertyId;
    if (!propertyId) return;
    void getPropertyPhotoHistory(propertyId)
      .then(setPhotoHistory)
      .catch(() => setPhotoHistory(null));
  }, [board.property?.propertyId]);

  const history = useMemo(() => board.visits
    .filter((visit) => visit.status === "completed")
    .sort((a, b) => String(b.scheduledDate || b.createdAt).localeCompare(String(a.scheduledDate || a.createdAt))), [board.visits]);

  const resolvedTasks = useMemo(() => board.tasks
    .filter((task) => task.status === "resolved")
    .sort((a, b) => String(b.resolvedAt || b.createdAt).localeCompare(String(a.resolvedAt || a.createdAt))), [board.tasks]);

  const selectedVisit = history.find((visit) => visit.id === selectedVisitId) || null;
  const selectedPhotoVisit = photoHistory?.visits.find((visit) => visit.id === selectedVisitId) || null;
  const selectedFeedback = board.feedback.find((feedback) => feedback.visitId === selectedVisitId) || null;

  function openDispute(visitId: string) {
    setDisputeVisitId(visitId);
    setDisputeReason("");
    setDisputeMessage("");
    setSupportEmail("");
  }

  async function submitDispute(visitId: string) {
    const reason = disputeReason.trim();
    if (reason.length < 5) {
      setDisputeMessage("Please explain what is wrong with this payment.");
      return;
    }
    setDisputeBusy(true);
    setDisputeMessage("");
    try {
      const client = getSupabaseBrowserClient() as any;
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/customer/payment-disputes", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ visitId, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Payment dispute could not be opened.");
      setSupportEmail(String(result.supportEmail || ""));
      setDisputeMessage(result.duplicate
        ? "This payment already has an open dispute. The company is reviewing it."
        : result.payoutHeld
          ? "Dispute opened. The company payout for this payment is now on hold while it is investigated."
          : "Dispute opened. The company has been notified for investigation.");
      setDisputeReason("");
    } catch (event) {
      setDisputeMessage(event instanceof Error ? event.message : "Payment dispute could not be opened.");
    } finally {
      setDisputeBusy(false);
    }
  }

  return <PortalShell type="Customer" active="History">
    <div className="app-top">
      <div>
        <span className="eyebrow">Service History · Supabase</span>
        <h1>Completed Service History</h1>
        <p className="section-intro">Open any completed day to see the service record and photos. If a completed service has a payment problem, you can contest that payment from the same history.</p>
      </div>
    </div>

    {error && <div className="notice" style={{ marginBottom: 18 }}>{error}</div>}

    <div className="customer-completed-visit-list">
      {history.length === 0 ? <div className="card profile-card">
        <h3>No completed services yet</h3>
        <p>Completed visits will appear here after the crew marks them done.</p>
      </div> : history.map((visit) => {
        const photoVisit = photoHistory?.visits.find((item) => item.id === visit.id);
        const firstPhoto = photoVisit?.photos[0]?.url || photoHistory?.profilePhotoUrl || null;
        const disputeOpen = disputeVisitId === visit.id;
        return <article className="customer-completed-visit-row" key={visit.id}>
          <button type="button" className="customer-completed-visit-card" onClick={() => setSelectedVisitId(visit.id)}>
            <div className="customer-completed-thumb">{firstPhoto ? <img src={firstPhoto} alt="Completed property service" /> : <span>⌂</span>}</div>
            <div>
              <span>COMPLETED · {niceDate(visit.scheduledDate)}</span>
              <strong>{visit.serviceName}</strong>
              <small>{visit.address || board.property?.address || "Customer property"} · {visit.crewName || "Crew"}</small>
            </div>
            <em>{photoVisit?.photos.length || 0} photo{photoVisit?.photos.length === 1 ? "" : "s"} ›</em>
          </button>
          <button type="button" className="customer-payment-dispute-trigger" onClick={() => disputeOpen ? setDisputeVisitId("") : openDispute(visit.id)}>{disputeOpen ? "Close" : "Contest payment"}</button>
          {disputeOpen && <div className="customer-payment-dispute-panel">
            <div><strong>Contest this payment</strong><p>Use this only for a payment linked to this completed service. The company receives the request and any payout that has not been transferred yet is held while the issue is investigated.</p></div>
            <textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="Tell the company what is wrong with this charge..." maxLength={1000} />
            <div className="customer-payment-dispute-actions"><button type="button" className="btn btn-primary" disabled={disputeBusy || disputeReason.trim().length < 5} onClick={() => void submitDispute(visit.id)}>{disputeBusy ? "Submitting..." : "Submit dispute"}</button>{supportEmail && <a href={`mailto:${supportEmail}`}>Email company · {supportEmail}</a>}</div>
            {disputeMessage && <p className="customer-payment-dispute-message">{disputeMessage}</p>}
          </div>}
        </article>;
      })}
    </div>

    <section className="card profile-card" style={{ marginTop: 20 }}>
      <div className="table-head">
        <div><h2>Return Visit History</h2><p>Resolved customer tasks and service issues.</p></div>
        <span className="pill green">{resolvedTasks.length} resolved</span>
      </div>
      <div className="history-list">
        {resolvedTasks.length === 0 ? <div className="empty-state"><strong>No return visits completed yet.</strong><p>When a return visit is completed, details will appear here.</p></div> : resolvedTasks.map((task) => {
          const isOpen = openTaskId === task.id;
          return <div className="history-item" key={task.id}>
            <button className="history-summary" onClick={() => setOpenTaskId(isOpen ? "" : task.id)}>
              <div><strong>{niceDate(task.resolvedAt)}</strong><span>{task.title} · {task.address}</span></div>
              <em>{isOpen ? "−" : "+"}</em>
            </button>
            {isOpen && <div className="history-detail">
              <div className="history-comment"><span>Your issue</span><em>{task.customerIssue}</em></div>
              <div className="history-comment done"><span>What was done</span><em>{task.completionSummary || "Return visit completed and saved."}</em></div>
            </div>}
          </div>;
        })}
      </div>
    </section>

    {selectedVisit && <CustomerServiceVisitModal
      visit={selectedVisit}
      property={board.property}
      photoVisit={selectedPhotoVisit}
      profilePhotoUrl={photoHistory?.profilePhotoUrl}
      feedback={selectedFeedback}
      onClose={() => setSelectedVisitId("")}
    />}

    <style jsx global>{`
      .customer-completed-visit-list{display:grid;gap:11px}.customer-completed-visit-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch}.customer-completed-visit-card{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:16px;align-items:center;width:100%;padding:12px;border:1px solid #dce7e1;border-radius:19px;background:#fff;text-align:left;cursor:pointer;transition:.18s ease}.customer-completed-visit-card:hover{transform:translateY(-1px);border-color:#91bba7;box-shadow:0 12px 28px rgba(9,73,50,.08)}.customer-completed-thumb{width:104px;height:78px;overflow:hidden;border-radius:14px;background:#e8f1ec;display:grid;place-items:center;color:#39745b;font-size:34px}.customer-completed-thumb img{width:100%;height:100%;object-fit:cover}.customer-completed-visit-card>div:nth-child(2){display:grid;gap:4px}.customer-completed-visit-card span{color:#27805a;font-size:10px;font-weight:900;letter-spacing:.08em}.customer-completed-visit-card strong{color:#163a2e;font-size:18px}.customer-completed-visit-card small{color:#6c7b73}.customer-completed-visit-card em{font-style:normal;color:#39745b;font-size:12px;font-weight:850}.customer-payment-dispute-trigger{min-width:132px;padding:0 14px;border:1px solid #d5e4dc;border-radius:16px;background:#f8fbf9;color:#356754;font-weight:850;cursor:pointer}.customer-payment-dispute-trigger:hover{border-color:#91bba7;background:#eef8f2}.customer-payment-dispute-panel{grid-column:1/-1;display:grid;gap:10px;padding:16px;border:1px solid #d7e6de;border-radius:18px;background:#f8fbf9}.customer-payment-dispute-panel strong{color:#15392d}.customer-payment-dispute-panel p{margin:4px 0 0;color:#66786e;line-height:1.5}.customer-payment-dispute-panel textarea{width:100%;min-height:92px;resize:vertical;padding:12px;border:1px solid #cbdad2;border-radius:12px;background:#fff;color:#173a2c;font:inherit}.customer-payment-dispute-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.customer-payment-dispute-actions a{color:#0b7655;font-weight:800;text-decoration:none}.customer-payment-dispute-message{padding:10px 12px;border-radius:10px;background:#e8f5ed!important;color:#176344!important;font-weight:700}@media(max-width:700px){.customer-completed-visit-row{grid-template-columns:1fr}.customer-completed-visit-card{grid-template-columns:78px minmax(0,1fr);padding:10px}.customer-completed-thumb{width:78px;height:72px}.customer-completed-visit-card em{grid-column:2}.customer-payment-dispute-trigger{min-height:44px}.customer-payment-dispute-panel{grid-column:1}}
    `}</style>
  </PortalShell>;
}
