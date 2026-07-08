"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  finishServiceSession,
  formatDuration,
  getActivityLogs,
  getEmployeeTasks,
  getLead,
  getSessionForLead,
  Lead,
  LawnSize,
  GrassHandling,
  GrassHeight,
  resetServiceSession,
  setPropertyPhoto,
  startServiceSession,
  updateLead,
  updatePropertyDetails,
  calculateVisitStatus,
} from "@/lib/storage";

const tabs = ["Customer", "Property", "Service", "History", "Feedback History"];
const grassOptions: { value: GrassHandling; label: string }[] = [
  { value: "mulched", label: "Mulched" },
  { value: "bag_green_bin", label: "Bag to green bin" },
  { value: "bag_leave_property", label: "Bag and leave on property" },
  { value: "no_preference", label: "No preference" },
];
function tabKey(label: string) { return label.toLowerCase(); }
function visitLabel(lead: Lead) { return lead.status === "completed" ? "Done" : "Open"; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [lead, setLead] = useState<Lead | null>(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "customer");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const [comment, setComment] = useState("");

  function refresh() { setLead(getLead(params.id)); }
  useEffect(() => { refresh(); const t = setInterval(() => setTick((v) => v + 1), 1000); return () => clearInterval(t); }, [params.id]);

  const defaultDetails = { lawnSize: "small" as LawnSize, grassHeight: "3in" as GrassHeight, grassHandling: "no_preference" as GrassHandling, backyard: true, gated: false, adminNotes: "", propertyAlerts: "", accessNotes: "" };
  const details = lead?.propertyDetails || defaultDetails;
  const session = lead ? getSessionForLead(lead.id) : null;
  const tasks = lead ? getEmployeeTasks().filter((t) => t.leadId === lead.id) : [];
  const openTasks = tasks.filter((t) => t.status !== "resolved");
  const logs = lead ? getActivityLogs().filter((a) => a.target === lead.id || a.target === lead.name || a.details.includes(lead.address) || a.details.includes(lead.name)).slice(0, 20) : [];
  const runningSeconds = useMemo(() => {
    if (!session) return 0;
    if (session.status === "running" && session.startedAt) return Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000));
    return session.durationSeconds || 0;
  }, [session, tick]);

  if (!lead) return <AdminShell active="Customers"><div className="card profile-card"><h2>Property not found</h2></div></AdminShell>;

  function saveAll() { if (!lead) return; updateLead(lead.id, { name: lead.name, phone: lead.phone, email: lead.email, address: lead.address, service: lead.service, notes: lead.notes }); updatePropertyDetails(lead.id, details); setMessage("Saved. Customer, property and operations now use this same record."); refresh(); }
  function updateDetails(patch: Partial<typeof details>) { if (!lead) return; setLead({ ...lead, propertyDetails: { ...details, ...patch } }); }
  function start() { if (!lead) return; startServiceSession(lead.id, "Admin", lead.assignedCrew || "Admin"); setMessage("Timer started manually."); refresh(); }
  function finish() { if (!lead) return; const done = finishServiceSession(lead.id, comment); setMessage(done ? "Service finished. Status is Done across the system." : "Finish blocked: no active timer was running."); refresh(); }
  function reset() { if (!lead) return; resetServiceSession(lead.id); setComment(""); setMessage("Only this house was reset. Status is Open across the system."); refresh(); }
  async function uploadPropertyPhoto(e: ChangeEvent<HTMLInputElement>) { if (!lead) return; const file = e.target.files?.[0]; if (!file) return; const data = await fileToDataUrl(file); setPropertyPhoto(lead.id, data); setMessage("Official property photo updated."); refresh(); }

  return <AdminShell active="Customers">
    <div className="app-top"><div><span className="eyebrow">V43 · Property Service Screen</span><h1>{lead.address || lead.name}</h1><p className="section-intro">{lead.name} · {lead.phone || "No phone"} · {lead.email || "No email"}</p></div><div className="row"><span className={`visit-badge ${calculateVisitStatus(lead)}`}><i></i>{visitLabel(lead)}</span><button className="btn btn-primary" onClick={saveAll}>Save</button></div></div>
    <div className="client-tabs">{tabs.map((t) => <button key={t} className={tab === tabKey(t) ? "client-tab active" : "client-tab"} onClick={() => setTab(tabKey(t))}>{t}</button>)}</div>

    {tab === "customer" && <section className="card profile-card"><h2>Edit Customer</h2><div className="form-grid"><div className="field"><label>Name</label><input className="input" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} /></div><div className="field"><label>Phone</label><input className="input" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} /></div><div className="field"><label>Email</label><input className="input" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} /></div><div className="field"><label>Customer Notes</label><input className="input" value={lead.notes || ""} onChange={(e) => setLead({ ...lead, notes: e.target.value })} /></div></div></section>}

    {tab === "property" && <section className="card profile-card"><h2>Edit Property</h2><div className="house-image" style={{ marginBottom: 16 }}>{lead.propertyPhoto ? <img src={lead.propertyPhoto} alt="Property" /> : <div className="house-placeholder">🏠</div>}</div><input className="input" type="file" accept="image/*" onChange={uploadPropertyPhoto} /><div className="form-grid" style={{ marginTop: 16 }}><div className="field"><label>Address</label><input className="input" value={lead.address} onChange={(e) => setLead({ ...lead, address: e.target.value })} /></div><div className="field"><label>Lot Size</label><select className="input" value={details.lawnSize} onChange={(e) => updateDetails({ lawnSize: e.target.value as LawnSize })}><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></div><div className="field"><label>Grass Height</label><select className="input" value={details.grassHeight} onChange={(e) => updateDetails({ grassHeight: e.target.value as any })}><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div><div className="field"><label>Grass Handling</label><select className="input" value={details.grassHandling} onChange={(e) => updateDetails({ grassHandling: e.target.value as GrassHandling })}>{grassOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div><div className="field"><label>Backyard</label><select className="input" value={details.backyard ? "yes" : "no"} onChange={(e) => updateDetails({ backyard: e.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></div><div className="field"><label>Gate</label><select className="input" value={details.gated ? "yes" : "no"} onChange={(e) => updateDetails({ gated: e.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></div></div><div className="field"><label>Access Notes</label><textarea className="input field-note" value={details.accessNotes || ""} onChange={(e) => updateDetails({ accessNotes: e.target.value })} /></div><div className="field"><label>Property Alerts</label><textarea className="input field-note" value={details.propertyAlerts || ""} onChange={(e) => updateDetails({ propertyAlerts: e.target.value })} /></div></section>}

    {tab === "service" && <section className="card profile-card"><div className="table-head"><div><h2>Service</h2><p className="section-intro">Start, Finish and Reset are controlled here. Done never happens automatically.</p></div><span className={`visit-badge ${calculateVisitStatus(lead)}`}><i></i>{visitLabel(lead)}</span></div><div className="detail-grid" style={{ marginBottom: 16 }}><div className="detail-box"><div className="detail-label">Timer</div><div className="detail-value">{formatDuration(runningSeconds)}</div><small>{session?.status || "no timer"}</small></div><div className="detail-box"><div className="detail-label">Open Return Visits</div><div className="detail-value">{openTasks.length}</div><small>{openTasks[0]?.description || "No return visit"}</small></div></div><div className="form-grid"><div className="field"><label>Service</label><input className="input" value={lead.service} onChange={(e) => setLead({ ...lead, service: e.target.value })} /></div><div className="field"><label>Assigned Crew</label><input className="input" value={lead.assignedCrew || ""} onChange={(e) => setLead({ ...lead, assignedCrew: e.target.value })} /></div><div className="field"><label>Service Day</label><input className="input" value={lead.serviceDay || ""} onChange={(e) => setLead({ ...lead, serviceDay: e.target.value })} /></div><div className="field"><label>Next Cut</label><input className="input" type="date" value={lead.nextVisitDate || lead.scheduledDate || ""} onChange={(e) => setLead({ ...lead, nextVisitDate: e.target.value, scheduledDate: e.target.value })} /></div></div><div className="field" style={{ marginTop: 16 }}><label>Completion comment</label><textarea className="input field-note" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment before Finish" /></div><div className="row wrap" style={{ marginTop: 18 }}><button className="btn btn-primary" onClick={start} disabled={session?.status === "running" || session?.status === "finished"}>Start</button><button className="btn btn-outline" onClick={finish} disabled={session?.status !== "running"}>Finish</button><button className="btn btn-outline" onClick={reset}>Reset this house</button><Link className="btn btn-outline" href={`/employee/route?property=${lead.id}`}>Employee View</Link></div></section>}

    {tab === "history" && <section className="card profile-card"><h2>History</h2><div className="history-list">{logs.length ? logs.map((a) => <div className="history-day" key={a.id}><button><span>{new Date(a.createdAt).toLocaleString()}</span><strong>{a.action}</strong><em>{a.actor}</em></button><div className="history-detail"><p>{a.details}</p></div></div>) : <div className="empty-state"><strong>No history yet.</strong><p>Start, Finish, feedback, tasks and edits will appear here.</p></div>}</div></section>}

    {tab === "feedback history" && <section className="card profile-card"><div className="table-head"><div><h2>Feedback History</h2><p className="section-intro">Read-only record of completed visits and customer reviews. Admin cannot edit customer ratings.</p></div><span className="pill">Read only</span></div><div className="table-wrap"><table><thead><tr><th>Visit</th><th>Employee</th><th>Timer</th><th>Customer Feedback</th><th>Comment</th></tr></thead><tbody><tr><td><strong>{lead.service}</strong><br/><small>{session?.finishedAt ? new Date(session.finishedAt).toLocaleString() : lead.status === "completed" ? "Completed date not recorded" : "Not completed yet"}</small></td><td>{session?.employee || lead.assignedCrew || "Crew"}<br/><small>{session?.crew || "-"}</small></td><td>{formatDuration(session?.durationSeconds || runningSeconds)}</td><td>{lead.feedback?.rating ? `${lead.feedback.rating} ★` : lead.status === "completed" ? "No feedback left" : "Waiting completion"}</td><td>{lead.feedback?.comment || session?.completionComment || "-"}</td></tr>{tasks.filter((t) => t.status === "resolved").map((t) => <tr key={t.id}><td><strong>Return Visit</strong><br/><small>{t.resolvedAt ? new Date(t.resolvedAt).toLocaleString() : "Resolved"}</small></td><td>{t.completedBy || t.assignedTo || "Employee"}</td><td>{formatDuration(t.durationSeconds || 0)}</td><td>No customer feedback left</td><td>{t.completionSummary || t.workDone || t.description}</td></tr>)}</tbody></table></div></section>}

    {message && <div className="payment-message" style={{ marginTop: 16 }}>{message}</div>}
  </AdminShell>;
}
