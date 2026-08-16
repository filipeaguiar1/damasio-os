"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { answerCompanyReferral, loadCompanyReferrals } from "@/lib/services/referralService";
import type { CompanyReferral } from "@/lib/repositories/referralRepository";

export default function ReferralsPage() {
  const [rows, setRows] = useState<CompanyReferral[]>([]);
  const [message, setMessage] = useState("Loading referrals...");
  const [busy, setBusy] = useState("");

  async function refresh() {
    const data = await loadCompanyReferrals();
    setRows(data);
    setMessage(data.length ? "Choose whether the company accepts each referral." : "No Master referrals waiting.");
  }

  useEffect(() => { void refresh(); }, []);

  async function answer(row: CompanyReferral, accept: boolean) {
    setBusy(row.id);
    try {
      const result = await answerCompanyReferral(row, accept);
      setRows(result.referrals);
      setMessage(result.accessWarning
        ? `${result.message} Customer access needs attention: ${result.accessWarning}`
        : result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Referral could not be updated.");
    } finally {
      setBusy("");
    }
  }

  const pending = rows.filter((row) => row.status === "offered");

  return <AdminShell active="Referrals">
    <div className="app-top"><div><span className="eyebrow">Master → Company</span><h1>Client Referrals</h1><p className="section-intro">The company accepts or declines clients offered by 4Ever Seasons Master. Acceptance releases the Quote to the Customer; the operational Job is created only after the Customer approves it.</p></div><button className="btn btn-outline" onClick={() => void refresh()}>Refresh</button></div>
    {message && <div className="payment-message" style={{ marginBottom: 16 }}>{message}</div>}
    <section className="card table-card"><div className="table-head"><div><h2>Referral Inbox</h2><p className="section-intro">Accepting a referral confirms company ownership and releases Customer access. It does not create a Job or Invoice by itself.</p></div><span className="pill">{pending.length} pending</span></div><div className="table-wrap"><table><thead><tr><th>Client</th><th>Service</th><th>Status</th><th>Decision</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4}>No referrals.</td></tr> : rows.map((row) => <tr key={row.id}><td><strong>{row.fullName}</strong><br /><small>{row.address || row.email || row.phone || "Contact pending"}</small></td><td>{row.serviceRequested || "Property Service"}</td><td><span className="status">{row.status}</span></td><td>{row.status === "offered" ? <div className="row"><button className="btn btn-primary" disabled={busy === row.id} onClick={() => void answer(row, true)}>Accept</button><button className="btn btn-outline" disabled={busy === row.id} onClick={() => void answer(row, false)}>Decline</button></div> : <small>Answered</small>}</td></tr>)}</tbody></table></div></section>
  </AdminShell>;
}
