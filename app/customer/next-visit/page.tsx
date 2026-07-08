"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };
function formatLongDate(value?: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Pending Scheduling"; }
function pretty(v?: string | null) { return v ? v.replace("in", '"') : "not set"; }

export default function NextVisit() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [error, setError] = useState("");
  useEffect(() => { loadCustomerPortal().then(setBoard).catch((e) => setError(e.message)); }, []);
  const next = useMemo(() => board.visits.filter((v) => v.status !== "completed" && v.status !== "cancelled").sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0], [board.visits]);
  return <PortalShell type="Customer" active="Services"><div className="neo-hero customer-hero"><div><span className="eyebrow">Next Visit · Supabase</span><h1>{formatLongDate(next?.scheduledDate)}</h1><p>{next ? `${next.crewName || "Crew"} is scheduled to visit your property. No fixed visit hour is promised.` : "Your next service is waiting to be scheduled."}</p></div><Link className="btn btn-outline" href="/customer/history">Service History</Link></div>{error && <div className="notice" style={{ marginBottom: 18 }}>{error}</div>}{!next ? <section className="card profile-card"><h2>Waiting to be scheduled</h2><p>Your next visit has not been booked yet.</p></section> : <section className="card profile-card"><h2>{next.serviceName}</h2><p><strong>{next.address}</strong></p><div className="detail-grid"><div className="detail-box"><div className="detail-label">Visit Date</div><div className="detail-value">{formatLongDate(next.scheduledDate)}</div></div><div className="detail-box"><div className="detail-label">Crew</div><div className="detail-value">{next.crewName || "Crew pending"}</div></div><div className="detail-box"><div className="detail-label">Status</div><div className="detail-value">{next.status}</div></div><div className="detail-box"><div className="detail-label">Grass Height</div><div className="detail-value">{pretty(board.property?.grassHeight)}</div></div><div className="detail-box"><div className="detail-label">Lot Size</div><div className="detail-value">{board.property?.lotSize || "not set"}</div></div><div className="detail-box"><div className="detail-label">Access</div><div className="detail-value">{board.property?.accessNotes || "No special access note"}</div></div></div></section>}</PortalShell>;
}
