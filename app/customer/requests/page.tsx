"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { addCustomerServiceRequest, loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const emptyBoard: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

type ServiceChoice = "Spring Cleanup" | "Fall Cleanup" | "Custom Request" | "Service Issue";

export default function Requests() {
  const [board, setBoard] = useState<CustomerPortalBoard>(emptyBoard);
  const [service, setService] = useState<ServiceChoice>("Spring Cleanup");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  function refresh() { loadCustomerPortal().then(setBoard).catch((e) => setNotice(e.message)); }
  useEffect(() => refresh(), []);
  async function submit() {
    setLoading(true); setNotice("");
    try { const updated = await addCustomerServiceRequest({ serviceName: service, message }); setBoard(updated); setMessage(""); setConfirm(false); setNotice("Request sent to Admin."); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Request failed."); }
    finally { setLoading(false); }
  }
  const pending = board.requests.filter((r) => r.status === "pending").length;
  return <PortalShell type="Customer" active="Requests">
    <div className="app-top"><div><span className="eyebrow">Extra Services · Supabase</span><h1>Request Service</h1><p className="section-intro">Requests are saved to Supabase and shown to Admin through Activity History.</p></div><Link className="btn btn-outline" href="/customer/estimates">My Estimates</Link></div>
    {notice && <div className="notice" style={{ marginBottom: 18 }}>{notice}</div>}
    <section className="grid-3">
      {["Spring Cleanup", "Fall Cleanup", "Custom Request", "Service Issue"].map((option) => <button key={option} className={service === option ? "card portal-card request-choice active" : "card portal-card request-choice"} onClick={() => setService(option as ServiceChoice)}><h3>{option}</h3><p>{option === "Service Issue" ? "Report something missed or not completed." : "Admin will review and send the next step."}</p></button>)}
    </section>
    <div className="card profile-card" style={{ marginTop: 20 }}>
      <div className="field"><label>Selected house</label><input className="input" value={board.property?.address || "Customer property"} readOnly /></div>
      <div className="field"><label>Details</label><textarea className="input" style={{ minHeight: 130 }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what you need, gate access, pets, notes..." /></div>
      {!confirm ? <button className="btn btn-primary" onClick={() => setConfirm(true)}>Send Request</button> : <div className="confirm-box"><h3>Confirm request?</h3><p>This will send <strong>{service}</strong> to Admin.</p><div className="row"><button className="btn btn-primary" disabled={loading} onClick={submit}>{loading ? "Sending..." : "Yes, send"}</button><button className="btn btn-outline" onClick={() => setConfirm(false)}>Cancel</button></div></div>}
    </div>
    <section className="card table-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>My Requests</h2><p className="section-intro"><strong>{pending}</strong> pending request(s).</p></div></div><div className="table-wrap"><table><thead><tr><th>Service</th><th>House</th><th>Status</th><th>Created</th></tr></thead><tbody>{board.requests.length === 0 ? <tr><td colSpan={4}>No requests yet.</td></tr> : board.requests.map((r) => <tr key={r.id}><td>{r.serviceName}</td><td>{r.address}</td><td><span className={`request-status ${r.status}`}>{r.status}</span></td><td>{new Date(r.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div></section>
  </PortalShell>;
}
