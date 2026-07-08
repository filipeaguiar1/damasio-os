"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
function niceDate(value?: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Not scheduled yet"; }

export default function CustomerTasksPage() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [open, setOpen] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { loadCustomerPortal().then(setBoard).catch((e) => setError(e.message)); }, []);
  const active = board.tasks.filter((t) => t.status === "open" || t.status === "assigned" || t.status === "in_progress");
  const resolved = board.tasks.filter((t) => t.status === "completed" || t.status === "resolved").sort((a, b) => String(b.resolvedAt || b.createdAt).localeCompare(String(a.resolvedAt || a.createdAt)));
  return <PortalShell type="Customer" active="Service Issues">
    <div className="app-top"><div><span className="eyebrow">Service Issues · Supabase</span><h1>Tasks & Return Visits</h1><p className="section-intro">Feedback and requests can create Admin-reviewed return visits for this property.</p></div><Link className="btn btn-primary" href="/customer/requests">Report New Issue</Link></div>
    {error && <div className="notice" style={{ marginBottom: 18 }}>{error}</div>}
    <section className="card profile-card"><div className="table-head"><div><h2>{active.length} active issue(s)</h2><p>Open, assigned and in-progress return visits stay here. Completed visits move to history for customer/admin review.</p></div><span className="pill">Customer view</span></div><div className="history-list">{active.length === 0 ? <div className="empty-state"><strong>No active service issues.</strong><p>If you report a problem, Admin will assign a return visit.</p></div> : active.map((t) => <div className="history-item" key={t.id}><button className="history-summary" onClick={() => setOpen(open === t.id ? "" : t.id)}><div><strong>{t.title}</strong><span>{t.address}</span></div><em>{open === t.id ? "−" : "+"}</em></button>{open === t.id && <div className="history-detail"><div className="grid-3 compact-grid"><div><span className="mini-label">Status</span><strong>{t.status}</strong></div><div><span className="mini-label">Return day</span><strong>{niceDate(t.scheduledDate)}</strong></div><div><span className="mini-label">Priority</span><strong>{t.priority}</strong></div></div><div className="history-comment"><span>Your issue</span><em>{t.customerIssue}</em></div></div>}</div>)}</div></section>
    <section className="card profile-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Completed Return Visits</h2><p>Completed task reports saved for your property.</p></div><span className="pill green">{resolved.length} completed</span></div><div className="history-list">{resolved.length === 0 ? <div className="empty-state"><strong>No completed return visits yet.</strong><p>Completed return visits will appear here.</p></div> : resolved.map((t) => { const isOpen = open === `done-${t.id}`; return <div className="history-item" key={t.id}><button className="history-summary" onClick={() => setOpen(isOpen ? "" : `done-${t.id}`)}><div><strong>{niceDate(t.resolvedAt)}</strong><span>{t.title} · {t.address}</span></div><em>{isOpen ? "−" : "+"}</em></button>{isOpen && <div className="history-detail"><div className="history-comment"><span>Your issue</span><em>{t.customerIssue}</em></div><div className="history-comment done"><span>What was done</span><em>{t.completionSummary || "Return visit completed and saved."}</em></div></div>}</div>; })}</div></section>
  </PortalShell>;
}
