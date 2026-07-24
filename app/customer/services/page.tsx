"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = {
  property: null,
  visits: [],
  tasks: [],
  requests: [],
  quotes: [],
  feedback: [],
};

function dateLabel(value?: string | null) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "Scheduling pending";
}

export default function CustomerServices() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCustomerPortal()
      .then(setBoard)
      .catch((event) => setError(event instanceof Error ? event.message : "Services could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const upcoming = useMemo(
    () => board.visits
      .filter((visit) => !["completed", "cancelled"].includes(visit.status))
      .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate))),
    [board.visits],
  );
  const completed = board.visits.filter((visit) => visit.status === "completed");
  const serviceNames = Array.from(new Set(board.visits.map((visit) => visit.serviceName).filter(Boolean)));
  const next = upcoming[0];

  return (
    <PortalShell type="Customer" active="Services">
      <div className="service-center-hero">
        <div>
          <span>PROPERTY CARE</span>
          <h1>{next ? "Your next service is scheduled." : "Your services in one place."}</h1>
          <p>{board.property?.address || "Services connected to your customer property."}</p>
        </div>
        <Link className="btn btn-primary" href="/customer/requests">Request service</Link>
      </div>

      {error && <div className="billing-message">{error}</div>}

      <section className="service-center-stats">
        <article><span>Upcoming</span><strong>{upcoming.length}</strong><small>Scheduled visits</small></article>
        <article><span>Completed</span><strong>{completed.length}</strong><small>Service history</small></article>
        <article><span>Service types</span><strong>{serviceNames.length}</strong><small>Connected records</small></article>
      </section>

      <div className="service-center-grid">
        <section className="service-center-panel next">
          <header><div><span>NEXT VISIT</span><h2>{next?.serviceName || "Waiting for scheduling"}</h2></div><Link href="/customer/next-visit">Details</Link></header>
          {loading ? (
            <div className="service-center-empty">Loading your service schedule...</div>
          ) : next ? (
            <div className="service-next-detail">
              <div><span>Date</span><strong>{dateLabel(next.scheduledDate)}</strong></div>
              <div><span>Crew</span><strong>{next.crewName || "Crew pending"}</strong></div>
              <div><span>Status</span><strong>{next.status}</strong></div>
              <p>No fixed arrival hour is promised. The route order is managed by the company.</p>
            </div>
          ) : (
            <div className="service-center-empty">Admin has not published the next visit yet.</div>
          )}
        </section>

        <section className="service-center-panel">
          <header><div><span>CONNECTED SERVICES</span><h2>Property care</h2></div><Link href="/customer/history">History</Link></header>
          <div className="service-type-list">
            {serviceNames.map((name) => {
              const visits = board.visits.filter((visit) => visit.serviceName === name);
              const nextService = visits
                .filter((visit) => !["completed", "cancelled"].includes(visit.status))
                .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0];
              const completedCount = visits.filter((visit) => visit.status === "completed").length;
              return (
                <article key={name}>
                  <i>✦</i>
                  <div><strong>{name}</strong><span>{nextService ? `Next: ${dateLabel(nextService.scheduledDate)}` : `${completedCount} completed`}</span></div>
                  <b>{nextService ? "Active" : "History"}</b>
                </article>
              );
            })}
            {!loading && serviceNames.length === 0 && <div className="service-center-empty">No service records are connected yet.</div>}
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
