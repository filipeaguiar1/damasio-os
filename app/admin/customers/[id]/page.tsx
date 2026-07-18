"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getCustomerPropertyDirectory } from "@/lib/services/customerPropertyService";
import { loadSchedulingDispatchBoard } from "@/lib/services/schedulingService";
import {
  formatDuration,
  getActivityLogs,
  getEmployeeTasks,
  getLead,
  getSessionForLead,
  Lead,
  LawnSize,
  GrassHandling,
  GrassHeight,
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
function clock(value?:string){return value?new Date(value).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}
function handlingLabel(value:GrassHandling){return grassOptions.find(option=>option.value===value)?.label||"No preference"}
function lotLabel(value:LawnSize){return({xs:"XS lot",small:"Small lot",legacy:"Legacy lot",oversize:"Oversized lot"} as Record<string,string>)[value]||value}

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [lead, setLead] = useState<Lead | null>(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "customer");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const [detailsOpen,setDetailsOpen]=useState(true);
  const [editOpen,setEditOpen]=useState(false);

  async function refresh() {
    const local=getLead(params.id);if(local){setLead(local);return}
    try{const[records,board]=await Promise.all([getCustomerPropertyDirectory(),loadSchedulingDispatchBoard({force:true})]);const record=records.find(item=>item.propertyId===params.id||item.customerId===params.id);if(!record){setLead(null);return}const jobs=[...board.unscheduledJobs,...board.assignedJobs];const job=jobs.find(item=>item.propertyId===record.propertyId);const visits=board.visits.filter(item=>item.propertyId===record.propertyId).sort((a,b)=>b.scheduledDate.localeCompare(a.scheduledDate));const visit=visits[0];setLead({id:record.propertyId,createdAt:record.createdAt,name:record.fullName,phone:record.phone||"",email:record.email||"",address:[record.addressLine1,record.city,record.province,record.postalCode].filter(Boolean).join(", "),service:job?.serviceName||visit?.serviceName||"Property Service",serviceFrequency:(job?.frequency as any)||"one_time",status:visit?.status==="completed"?"completed":"booked",subtotal:0,tax:0,total:0,notes:record.customerNotes||undefined,assignedCrew:job?.crewName||visit?.crewName||undefined,scheduledDate:visit?.scheduledDate||job?.recurrenceAnchorDate||undefined,nextVisitDate:job?.nextVisitDate||undefined,canonicalVisitId:visit?.id,visitStartedAt:visit?.startedAt||undefined,visitFinishedAt:visit?.finishedAt||undefined,visitDurationSeconds:visit?.durationSeconds||undefined,photos:[],propertyDetails:{lawnSize:record.lotSize||"small",grassHeight:record.grassHeight||"3in",grassHandling:record.propertyNotes?.toLowerCase().includes("green bin")?"bag_green_bin":record.propertyNotes?.toLowerCase().includes("bag")?"bag_leave_property":"no_preference",backyard:true,gated:record.gate,accessNotes:record.accessNotes||undefined,adminNotes:record.propertyNotes||undefined}})}catch{setLead(null)}
  }
  useEffect(() => { void refresh(); const t = setInterval(() => setTick((v) => v + 1), 1000); return () => clearInterval(t); }, [params.id]);

  const defaultDetails = { lawnSize: "small" as LawnSize, grassHeight: "3in" as GrassHeight, grassHandling: "no_preference" as GrassHandling, backyard: true, gated: false, adminNotes: "", propertyAlerts: "", accessNotes: "" };
  const details = lead?.propertyDetails || defaultDetails;
  const session = lead ? getSessionForLead(lead.id) : null;
  const tasks = lead ? getEmployeeTasks().filter((t) => t.leadId === lead.id) : [];
  const openTasks = tasks.filter((t) => t.status !== "resolved");
  const logs = lead ? getActivityLogs().filter((a) => a.target === lead.id || a.target === lead.name || a.details.includes(lead.address) || a.details.includes(lead.name)).slice(0, 20) : [];
  const runningSeconds = useMemo(() => {
    if (!session) return lead?.visitDurationSeconds||0;
    if (session.status === "running" && session.startedAt) return Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000));
    return session.durationSeconds || 0;
  }, [session, tick,lead?.visitDurationSeconds]);

  if (!lead) return <AdminShell active="Customers"><div className="card profile-card"><h2>Property not found</h2></div></AdminShell>;

  function saveAll() { if (!lead) return; updateLead(lead.id, { name: lead.name, phone: lead.phone, email: lead.email, address: lead.address, service: lead.service, notes: lead.notes }); updatePropertyDetails(lead.id, details); setMessage("Saved. Customer, property and operations now use this same record."); void refresh(); }
  function updateDetails(patch: Partial<typeof details>) { if (!lead) return; setLead({ ...lead, propertyDetails: { ...details, ...patch } }); }

  return <AdminShell active="Customers">
    <div className="app-top"><div><span className="eyebrow">V43 · Property Service Screen</span><h1>{lead.address || lead.name}</h1><p className="section-intro">{lead.name} · {lead.phone || "No phone"} · {lead.email || "No email"}</p></div><div className="row"><span className={`visit-badge ${calculateVisitStatus(lead)}`}><i></i>{visitLabel(lead)}</span><button className="btn btn-primary" onClick={saveAll}>Save</button></div></div>
    <div className="client-tabs">{tabs.map((t) => <button key={t} className={tab === tabKey(t) ? "client-tab active" : "client-tab"} onClick={() => setTab(tabKey(t))}>{t}</button>)}</div>

    {tab === "customer" && <section className="card profile-card"><h2>Edit Customer</h2><div className="form-grid"><div className="field"><label>Name</label><input className="input" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} /></div><div className="field"><label>Phone</label><input className="input" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} /></div><div className="field"><label>Email</label><input className="input" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} /></div><div className="field"><label>Customer Notes</label><input className="input" value={lead.notes || ""} onChange={(e) => setLead({ ...lead, notes: e.target.value })} /></div></div></section>}

    {tab === "property" && <section className="property-reference-layout">
      <div className="property-reference-head"><h2>Contract</h2><button type="button" onClick={()=>setDetailsOpen(value=>!value)}>{detailsOpen?"Hide details":"Show details"}</button></div>
      <article className="property-contract-summary"><div className="property-contract-thumb">{lead.propertyPhoto?<img src={lead.propertyPhoto} alt="Property"/>:<span>🏡</span>}</div><div><strong>{lead.service}</strong><small>{lead.serviceFrequency||"one time"} · {lead.nextVisitDate||lead.scheduledDate||"Route day pending"}</small></div><i>ⓘ</i></article>
      {detailsOpen&&<article className="property-compact-card">
        {(details.accessNotes||details.propertyAlerts)&&<div className="property-access-banner">ⓘ {details.accessNotes||details.propertyAlerts}</div>}
        <dl><div><dt>Cut height</dt><dd>{details.grassHeight.replace("in","")} inches</dd></div><div><dt>Grass clippings</dt><dd>{handlingLabel(details.grassHandling)}</dd></div><div><dt>Lot size</dt><dd>{lotLabel(details.lawnSize)}</dd></div><div><dt>Service level</dt><dd>{lead.serviceFrequency||"One time"}</dd></div><div><dt>Backyard / gate</dt><dd>{details.backyard?"Backyard":"No backyard"} · {details.gated?"Gated":"Open"}</dd></div></dl>
      </article>}
      <div className="property-visit-title">{lead.scheduledDate?new Date(`${lead.scheduledDate}T12:00:00`).toLocaleDateString([],{month:"short",day:"numeric"}):"Latest visit"}</div>
      <div className="property-time-cards"><div><span>Started</span><strong>{clock(session?.startedAt||lead.visitStartedAt)}</strong></div><div><span>Duration</span><strong>{formatDuration(session?.durationSeconds||lead.visitDurationSeconds||runningSeconds)}</strong></div><div><span>Finished</span><strong>{clock(session?.finishedAt||lead.visitFinishedAt)}</strong></div></div>
      <section className="property-images"><h3>Images</h3><div>{[lead.propertyPhoto,...(lead.photos||[])].filter(Boolean).map((photo,index)=><img key={index} src={photo} alt={`Property ${index+1}`}/>)}{!lead.propertyPhoto&&!(lead.photos||[]).length&&<div className="property-no-images">No images yet</div>}</div></section>
      <div className="property-edit-toggle"><button className="btn btn-outline" onClick={()=>setEditOpen(value=>!value)}>{editOpen?"Close editing":"Edit customer and property data"}</button><span className="pill">Operational controls are Employee-only</span></div>
      {editOpen&&<section className="card profile-card property-edit-panel"><div className="form-grid"><div className="field"><label>Address</label><input className="input" value={lead.address} onChange={(e) => setLead({ ...lead, address: e.target.value })} /></div><div className="field"><label>Lot Size</label><select className="input" value={details.lawnSize} onChange={(e) => updateDetails({ lawnSize: e.target.value as LawnSize })}><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></div><div className="field"><label>Grass Height</label><select className="input" value={details.grassHeight} onChange={(e) => updateDetails({ grassHeight: e.target.value as GrassHeight })}><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div><div className="field"><label>Grass Handling</label><select className="input" value={details.grassHandling} onChange={(e) => updateDetails({ grassHandling: e.target.value as GrassHandling })}>{grassOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div><div className="field"><label>Backyard</label><select className="input" value={details.backyard ? "yes" : "no"} onChange={(e) => updateDetails({ backyard: e.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></div><div className="field"><label>Gate</label><select className="input" value={details.gated ? "yes" : "no"} onChange={(e) => updateDetails({ gated: e.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></div></div><div className="field"><label>Access Notes</label><textarea className="input field-note" value={details.accessNotes || ""} onChange={(e) => updateDetails({ accessNotes: e.target.value })} /></div><div className="field"><label>Property Alerts</label><textarea className="input field-note" value={details.propertyAlerts || ""} onChange={(e) => updateDetails({ propertyAlerts: e.target.value })} /></div></section>}
    </section>}

    {tab === "service" && <section className="card profile-card"><div className="table-head"><div><h2>Service Overview</h2><p className="section-intro">Read-only operational view. Only the assigned Employee can start, finish, reset or upload completion photos.</p></div><span className={`visit-badge ${calculateVisitStatus(lead)}`}><i></i>{visitLabel(lead)}</span></div><div className="detail-grid"><div className="detail-box"><div className="detail-label">Service</div><div className="detail-value">{lead.service}</div><small>{lead.serviceFrequency||"one time"}</small></div><div className="detail-box"><div className="detail-label">Value</div><div className="detail-value">${Number(lead.total||lead.subtotal||0).toFixed(2)}</div><small>Customer contract</small></div><div className="detail-box"><div className="detail-label">Status</div><div className="detail-value">{visitLabel(lead)}</div><small>{lead.nextVisitDate||lead.scheduledDate||"Not scheduled"}</small></div><div className="detail-box"><div className="detail-label">Crew</div><div className="detail-value">{lead.assignedCrew||"Unassigned"}</div><small>Synced assignment</small></div><div className="detail-box"><div className="detail-label">Started</div><div className="detail-value">{clock(session?.startedAt||lead.visitStartedAt)}</div><small>Employee record</small></div><div className="detail-box"><div className="detail-label">Finished</div><div className="detail-value">{clock(session?.finishedAt||lead.visitFinishedAt)}</div><small>{formatDuration(session?.durationSeconds||lead.visitDurationSeconds||runningSeconds)}</small></div><div className="detail-box"><div className="detail-label">Open tasks</div><div className="detail-value">{openTasks.length}</div><small>{openTasks[0]?.description||"No return visit"}</small></div><div className="detail-box"><div className="detail-label">Completion</div><div className="detail-value">{session?.completionComment||"Pending"}</div><small>Read only</small></div></div></section>}

    {tab === "history" && <section className="card profile-card"><h2>History</h2><div className="history-list">{logs.length ? logs.map((a) => <div className="history-day" key={a.id}><button><span>{new Date(a.createdAt).toLocaleString()}</span><strong>{a.action}</strong><em>{a.actor}</em></button><div className="history-detail"><p>{a.details}</p></div></div>) : <div className="empty-state"><strong>No history yet.</strong><p>Start, Finish, feedback, tasks and edits will appear here.</p></div>}</div></section>}

    {tab === "feedback history" && <section className="card profile-card"><div className="table-head"><div><h2>Feedback History</h2><p className="section-intro">Read-only record of completed visits and customer reviews. Admin cannot edit customer ratings.</p></div><span className="pill">Read only</span></div><div className="table-wrap"><table><thead><tr><th>Visit</th><th>Employee</th><th>Timer</th><th>Customer Feedback</th><th>Comment</th></tr></thead><tbody><tr><td><strong>{lead.service}</strong><br/><small>{session?.finishedAt ? new Date(session.finishedAt).toLocaleString() : lead.status === "completed" ? "Completed date not recorded" : "Not completed yet"}</small></td><td>{session?.employee || lead.assignedCrew || "Crew"}<br/><small>{session?.crew || "-"}</small></td><td>{formatDuration(session?.durationSeconds || runningSeconds)}</td><td>{lead.feedback?.rating ? `${lead.feedback.rating} ★` : lead.status === "completed" ? "No feedback left" : "Waiting completion"}</td><td>{lead.feedback?.comment || session?.completionComment || "-"}</td></tr>{tasks.filter((t) => t.status === "resolved").map((t) => <tr key={t.id}><td><strong>Return Visit</strong><br/><small>{t.resolvedAt ? new Date(t.resolvedAt).toLocaleString() : "Resolved"}</small></td><td>{t.completedBy || t.assignedTo || "Employee"}</td><td>{formatDuration(t.durationSeconds || 0)}</td><td>No customer feedback left</td><td>{t.completionSummary || t.workDone || t.description}</td></tr>)}</tbody></table></div></section>}

    {message && <div className="payment-message" style={{ marginTop: 16 }}>{message}</div>}
  </AdminShell>;
}
