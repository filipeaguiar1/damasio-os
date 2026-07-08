"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
function niceDate(value?: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Date recorded"; }
function time(value?: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recorded"; }
function formatDuration(seconds?: number | null) { if (!seconds) return "Not recorded"; const m = Math.floor(seconds / 60); const s = seconds % 60; return m ? `${m} min ${s}s` : `${s}s`; }

export default function CustomerHistory() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [open, setOpen] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { loadCustomerPortal().then(setBoard).catch((e) => setError(e.message)); }, []);
  const history = board.visits.filter((v) => v.status === "completed").sort((a, b) => String(b.scheduledDate || b.createdAt).localeCompare(String(a.scheduledDate || a.createdAt)));
  const resolvedTasks = board.tasks.filter((t) => t.status === "resolved").sort((a, b) => String(b.resolvedAt || b.createdAt).localeCompare(String(a.resolvedAt || a.createdAt)));
  return <PortalShell type="Customer" active="History">
    <div className="app-top"><div><span className="eyebrow">Service History · Supabase</span><h1>Completed Service History</h1><p className="section-intro">Only this customer property is visible in the portal.</p></div></div>
    {error && <div className="notice" style={{ marginBottom: 18 }}>{error}</div>}
    <div className="history-list">{history.length === 0 ? <div className="card profile-card"><h3>No completed services yet</h3><p>Completed visits will appear here after the crew marks them done.</p></div> : history.map((item) => { const isOpen = open === item.id; const review = board.feedback.find((f) => f.visitId === item.id); return <div className="history-item" key={item.id}><button className="history-summary" onClick={() => setOpen(isOpen ? "" : item.id)}><div><strong>{niceDate(item.scheduledDate)}</strong><span>{item.serviceName} · {item.address}</span></div><em>{isOpen ? "−" : "+"}</em></button>{isOpen && <div className="history-detail"><div className="grid-3 compact-grid"><div><span className="mini-label">Crew</span><strong>{item.crewName || "Crew"}</strong></div><div><span className="mini-label">Completed at</span><strong>{time(item.finishedAt)}</strong></div><div><span className="mini-label">Timer</span><strong>{formatDuration(item.durationSeconds)}</strong></div></div><div className="history-comment done"><span>Visible summary</span><em>{item.customerVisibleSummary || item.employeeNotes || "Service completed."}</em></div>{review ? <div className="feedback-card"><div className="feedback-label">Your feedback</div><div className="feedback-value">{review.rating} ★ · {review.comment || "No comment"}</div></div> : <Link className="btn btn-primary" href="/customer/feedback">Review this service</Link>}</div>}</div>; })}</div>
    <section className="card profile-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Return Visit History</h2><p>Resolved customer tasks and service issues.</p></div><span className="pill green">{resolvedTasks.length} resolved</span></div><div className="history-list">{resolvedTasks.length === 0 ? <div className="empty-state"><strong>No return visits completed yet.</strong><p>When a return visit is completed, details will appear here.</p></div> : resolvedTasks.map((t) => { const isOpen = open === `task-${t.id}`; return <div className="history-item" key={t.id}><button className="history-summary" onClick={() => setOpen(isOpen ? "" : `task-${t.id}`)}><div><strong>{niceDate(t.resolvedAt)}</strong><span>{t.title} · {t.address}</span></div><em>{isOpen ? "−" : "+"}</em></button>{isOpen && <div className="history-detail"><div className="history-comment"><span>Your issue</span><em>{t.customerIssue}</em></div><div className="history-comment done"><span>What was done</span><em>{t.completionSummary || "Return visit completed and saved."}</em></div></div>}</div>; })}</div></section>
  </PortalShell>;
}
