"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

function niceDate(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Pending scheduling";
}

export default function Customer() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCustomerPortal().then(setBoard).catch((event) => setError(event.message));
  }, []);

  const next = useMemo(
    () => board.visits.filter((visit) => visit.status !== "completed" && visit.status !== "cancelled").sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0],
    [board.visits],
  );
  const completed = board.visits.filter((visit) => visit.status === "completed").length;
  const openIssues = board.tasks.filter((task) => task.status !== "resolved" && task.status !== "cancelled").length;
  const pendingReviews = board.visits.filter((visit) => visit.status === "completed" && !board.feedback.some((feedback) => feedback.visitId === visit.id)).length;
  const pendingRequests = board.requests.filter((request) => request.status === "pending").length;

  return (
    <PortalShell type="Customer" active="Dashboard">
      <div className="neo-hero customer-hero">
        <div>
          <span className="eyebrow">Customer Portal - Supabase</span>
          <h1>{board.property?.customerName || "Customer Portal"}</h1>
          <p>{board.property ? `${board.property.address}, ${board.property.city}` : "Only the customer property is shown here."}</p>
        </div>
        <Link className="btn btn-primary" href="/customer/requests">Request Service</Link>
      </div>
      {error && <div className="notice" style={{ marginBottom: 18 }}>{error}</div>}
      <section className="status-action-grid">
        <Link href="/customer/next-visit" className="status-action blue"><i>S</i><b>{next ? 1 : 0}</b><div><strong>Next Visit</strong><span>{niceDate(next?.scheduledDate)}</span></div><em>{">"}</em></Link>
        <Link href="/customer/history" className="status-action green"><i>OK</i><b>{completed}</b><div><strong>Completed</strong><span>Service history</span></div><em>{">"}</em></Link>
        <Link href="/customer/tasks" className="status-action red"><i>!</i><b>{openIssues}</b><div><strong>Service Issues</strong><span>Return visits</span></div><em>{">"}</em></Link>
        <Link href="/customer/feedback" className="status-action yellow"><i>*</i><b>{pendingReviews}</b><div><strong>Feedback</strong><span>{pendingReviews ? "Waiting review" : "All caught up"}</span></div><em>{">"}</em></Link>
        <Link href="/customer/requests" className="status-action red"><i>+</i><b>{pendingRequests}</b><div><strong>Requests</strong><span>Need help?</span></div><em>{">"}</em></Link>
      </section>
      <section className="card calendar-work-card">
        <div className="calendar-work-head">
          <div><h2>Next Scheduled Service</h2><span>{next ? "Live from Supabase" : "Waiting for Admin to schedule"}</span></div>
          <Link className="btn btn-outline" href="/customer/next-visit">Open Next Visit</Link>
        </div>
        {!next ? (
          <div className="empty-state"><strong>Pending Scheduling</strong><p>Your next visit will appear here after Admin books the day and crew.</p></div>
        ) : (
          <div className="pro-route-list">
            <div className="pro-route-row">
              <span className="route-number">1</span>
              <div className="home-thumb"><div></div></div>
              <div className="home-info"><strong>{next.serviceName}</strong><p>{next.address}</p><span className="freq">scheduled</span></div>
              <div className="crew-cell"><div className="crew-faces"><i></i><i></i></div><strong>{next.crewName || "Crew pending"}</strong><p>Route order only</p></div>
              <div className="booking-cell"><span className="dot booked"></span><strong>{next.status}</strong><p>Next: {niceDate(next.scheduledDate)}</p></div>
              <Link className="open-btn" href="/customer/next-visit">Open</Link>
            </div>
          </div>
        )}
      </section>
    </PortalShell>
  );
}
