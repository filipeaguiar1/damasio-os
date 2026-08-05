"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadSchedulingDispatchBoard } from "@/lib/services/schedulingService";
import { getPropertyPhotoHistory, type PropertyPhotoHistory } from "@/lib/services/propertyPhotoService";
import { calculateVisitStatus, formatDuration, type Lead } from "@/lib/storage";

const tabs = ["Customer", "Property", "Service", "History"];

type AdminRecord = {
  customer: any;
  property: any;
  permissions: {
    canEditCustomer: boolean;
    canEditProperty: boolean;
    contactHidden: boolean;
    lockedByPlatform: boolean;
  };
  offer: {
    status: string | null;
    price: number | null;
    sentAt: string | null;
    respondedAt: string | null;
    responseNote: string | null;
  };
};

function tabKey(label: string) { return label.toLowerCase(); }
function clock(value?: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"; }
function fullAddress(property: any) { return [property?.address_line1, property?.city, property?.province, property?.postal_code].filter(Boolean).join(", ") || "Address not set"; }
function lotLabel(value?: string | null) { return ({ xs: "Extra small", small: "Small", legacy: "Medium / standard", oversize: "Large / oversize" } as Record<string, string>)[value || ""] || "Not set"; }
function servicePlan(property: any) {
  const text = String(property?.property_notes || "");
  const read = (label: string) => text.match(new RegExp(`^${label}:\\s*(.*)$`, "mi"))?.[1]?.trim() || "";
  return { service: read("Service type") || "Property Service", frequency: read("Frequency") || "One time", notes: read("Operational notes") || "" };
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [record, setRecord] = useState<AdminRecord | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "customer");
  const [message, setMessage] = useState("Loading customer...");
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [photoHistory, setPhotoHistory] = useState<PropertyPhotoHistory | null>(null);
  const [responseNote, setResponseNote] = useState("");
  const [expandedVisitIds, setExpandedVisitIds] = useState<string[]>([]);

  async function refresh() {
    const token = await accessToken();
    const response = await fetch(`/api/admin/customers/${encodeURIComponent(params.id)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Customer profile could not be loaded.");
    const next = result as AdminRecord;
    setRecord(next);

    const [board, nextPhotoHistory] = await Promise.all([
      loadSchedulingDispatchBoard(),
      getPropertyPhotoHistory(next.property.id).catch(() => null),
    ]);
    const jobs = [...board.unscheduledJobs, ...board.assignedJobs];
    const job = jobs.find((item) => item.propertyId === next.property.id);
    const visits = board.visits.filter((item) => item.propertyId === next.property.id).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));
    const visit = visits[0];
    const plan = servicePlan(next.property);
    setLead({
      id: next.property.id,
      createdAt: next.property.created_at || next.customer.created_at,
      name: next.customer.full_name,
      phone: next.customer.phone || "",
      email: next.customer.email || "",
      address: fullAddress(next.property),
      service: job?.serviceName || visit?.serviceName || plan.service,
      serviceFrequency: (job?.frequency as any) || (plan.frequency.toLowerCase().replaceAll("-", "_") as any) || "one_time",
      status: visit?.status === "completed" ? "completed" : "booked",
      subtotal: Number(next.offer.price || 0),
      tax: 0,
      total: Number(next.offer.price || 0),
      notes: next.customer.notes || undefined,
      scheduledDate: visit?.scheduledDate || job?.recurrenceAnchorDate || undefined,
      nextVisitDate: job?.nextVisitDate || undefined,
      canonicalVisitId: visit?.id,
      visitStartedAt: visit?.startedAt || undefined,
      visitFinishedAt: visit?.finishedAt || undefined,
      visitDurationSeconds: visit?.durationSeconds || undefined,
      propertyPhoto: next.property.official_photo_url || undefined,
      photos: [],
      propertyDetails: {
        lawnSize: next.property.lot_size || "small",
        grassHeight: next.property.grass_height || "3in",
        grassHandling: next.property.property_notes?.toLowerCase().includes("green bin") ? "bag_green_bin" : next.property.property_notes?.toLowerCase().includes("bag") ? "bag_leave_property" : "no_preference",
        backyard: true,
        gated: Boolean(next.property.gate),
        accessNotes: next.property.access_notes || undefined,
        adminNotes: plan.notes || undefined,
      },
    });
    setPhotoHistory(nextPhotoHistory);
    setMessage("");
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [params.id]);

  const plan = useMemo(() => servicePlan(record?.property), [record?.property]);
  const visits = photoHistory?.visits || [];

  async function saveCustomer() {
    if (!record || !record.permissions.canEditCustomer) return;
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch(`/api/admin/customers/${encodeURIComponent(params.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ customer: { fullName: record.customer.full_name, phone: record.customer.phone || null, email: record.customer.email, notes: record.customer.notes || null } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be saved.");
      setMessage("Customer saved directly to the company database.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer could not be saved."); }
    finally { setBusy(false); }
  }

  async function respondToOffer(action: "accept" | "decline") {
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch(`/api/admin/customers/${encodeURIComponent(params.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, note: responseNote || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Offer response failed.");
      setMessage(result.message);
      setResponseNote("");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Offer response failed."); }
    finally { setBusy(false); }
  }

  function toggleVisit(visitId: string) {
    setExpandedVisitIds((current) => current.includes(visitId) ? current.filter((id) => id !== visitId) : [...current, visitId]);
  }

  if (!record || !lead) return <AdminShell active="Customers"><div className="card profile-card"><h2>{message || "Property not found"}</h2></div></AdminShell>;

  const property = record.property;
  const details = lead.propertyDetails!;
  const visitStatus = calculateVisitStatus(lead);

  return <AdminShell active="Customers">
    {message && <div className="payment-message" style={{ marginBottom: 16 }}>{message}</div>}

    {record.offer.status === "offered" && <section className="card profile-card" style={{ borderColor: "#d8a73d", marginBottom: 18 }}>
      <div className="table-head"><div><h2>New customer offer</h2><p className="section-intro">Master offered this property to your company. Accepting releases it to Schedule, Dispatch and Employee Route.</p></div><span className="pill">${Number(record.offer.price || 0).toFixed(2)} CAD</span></div>
      <div className="field"><label>Response note</label><textarea className="input field-note" value={responseNote} onChange={(event) => setResponseNote(event.target.value)} placeholder="Optional note to Master" /></div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}><button className="btn btn-outline" disabled={busy} onClick={() => void respondToOffer("decline")}>Decline</button><button className="btn btn-primary" disabled={busy} onClick={() => void respondToOffer("accept")}>Accept customer</button></div>
    </section>}

    <section className="property-service-hero">
      <div className="property-service-identity"><div className="property-service-avatar">{lead.propertyPhoto ? <img src={lead.propertyPhoto} alt="Property" /> : <span>⌂</span>}</div><div><span className="property-service-kicker">PROPERTY SERVICE · LIVE DATABASE RECORD</span><h1>{lead.address}</h1><p>{record.permissions.contactHidden ? `${lead.name} · Platform customer · Contact protected` : `${lead.name} · ${lead.phone || "No phone"} · ${lead.email || "No email"}`}</p></div></div>
      <div className="property-service-actions"><span className={`visit-badge ${visitStatus}`}><i></i>{lead.status === "completed" ? "Done" : "Open"}</span></div>
      <div className="property-service-summary"><div><small>Service</small><strong>{lead.service}</strong><span>{plan.frequency}</span></div><div><small>Next visit</small><strong>{lead.nextVisitDate || lead.scheduledDate || "Not scheduled"}</strong><span>Employee not assigned</span></div><div><small>Company value</small><strong>${Number(record.offer.price || 0).toFixed(2)}</strong><span>CAD service offer</span></div><div><small>History</small><strong>{visits.length}</strong><span>Visits in this company</span></div></div>
    </section>

    <div className="client-tabs property-service-tabs">{tabs.map((item) => <button key={item} className={tab === tabKey(item) ? "client-tab active" : "client-tab"} onClick={() => setTab(tabKey(item))}>{item}</button>)}</div>

    {tab === "customer" && <section className="card profile-card"><div className="table-head"><div><h2>{record.permissions.canEditCustomer ? "Customer" : "Platform customer"}</h2><p className="section-intro">{record.permissions.canEditCustomer ? "This customer belongs to your company. Changes save directly to the database." : "Contact details are protected and profile changes are Master-only."}</p></div>{record.permissions.lockedByPlatform && <span className="pill">Master managed</span>}</div><div className="form-grid"><div className="field"><label>Name</label><input className="input" disabled={!record.permissions.canEditCustomer} value={record.customer.full_name || ""} onChange={(event) => setRecord({ ...record, customer: { ...record.customer, full_name: event.target.value } })} /></div>{!record.permissions.contactHidden && <><div className="field"><label>Phone</label><input className="input" disabled={!record.permissions.canEditCustomer} value={record.customer.phone || ""} onChange={(event) => setRecord({ ...record, customer: { ...record.customer, phone: event.target.value } })} /></div><div className="field"><label>Email</label><input className="input" disabled={!record.permissions.canEditCustomer} value={record.customer.email || ""} onChange={(event) => setRecord({ ...record, customer: { ...record.customer, email: event.target.value } })} /></div></>}<div className="field"><label>Customer notes</label><input className="input" disabled={!record.permissions.canEditCustomer} value={record.customer.notes || ""} onChange={(event) => setRecord({ ...record, customer: { ...record.customer, notes: event.target.value } })} /></div></div>{record.permissions.canEditCustomer && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-primary" disabled={busy} onClick={() => void saveCustomer()}>{busy ? "Saving…" : "Save customer"}</button></div>}</section>}

    {tab === "property" && <section className="property-profile-card">
      <div className="property-main-photo">
        {lead.propertyPhoto ? <img src={lead.propertyPhoto} alt={`Front view of ${lead.address}`} /> : <div className="property-photo-placeholder"><span>⌂</span><strong>No house photo yet</strong><small>Customer or Admin can add the main property photo.</small></div>}
      </div>
      <div className="property-address-row"><div><small>Property</small><h2>{lead.address}</h2></div><span className={`visit-badge ${visitStatus}`}><i></i>{lead.status === "completed" ? "Done" : "Open"}</span></div>
      <div className="property-client-row"><span>Client</span><strong>{lead.name}</strong></div>
      <div className="property-contract-head"><div><small>Contract</small><h3>{lead.service}</h3><p>{plan.frequency} · {lead.nextVisitDate || lead.scheduledDate || "Route day pending"}</p></div><button type="button" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}>{detailsOpen ? "Hide details" : "Show details"}</button></div>
      {detailsOpen && <div className="property-contract-details">
        {details.accessNotes && <div className="property-access-banner">ⓘ {details.accessNotes}</div>}
        <dl><div><dt>Cut height</dt><dd>{String(details.grassHeight || "").replace("in", "")} inches</dd></div><div><dt>Lot size</dt><dd>{lotLabel(property.lot_size)}</dd></div><div><dt>Gate</dt><dd>{property.gate ? "Yes" : "No"}</dd></div><div><dt>Dog</dt><dd>{property.dog ? "Yes" : "No"}</dd></div><div><dt>Irrigation</dt><dd>{property.irrigation ? "Yes" : "No"}</dd></div><div><dt>Service level</dt><dd>{plan.frequency}</dd></div></dl>
      </div>}
      <div className="property-master-note">Property details are Master-only</div>
    </section>}

    {tab === "service" && <section className="card profile-card"><div className="table-head"><div><h2>Service overview</h2><p className="section-intro">Read-only operational data from the canonical job and visit records.</p></div><span className={`visit-badge ${visitStatus}`}><i></i>{lead.status === "completed" ? "Done" : "Open"}</span></div><div className="detail-grid"><div className="detail-box"><div className="detail-label">Property</div><div className="detail-value">{lead.address}</div><small>Database address</small></div><div className="detail-box"><div className="detail-label">Service</div><div className="detail-value">{lead.service}</div><small>{plan.frequency}</small></div><div className="detail-box"><div className="detail-label">Company value</div><div className="detail-value">${Number(record.offer.price || 0).toFixed(2)}</div><small>CAD</small></div><div className="detail-box"><div className="detail-label">Status</div><div className="detail-value">{lead.status === "completed" ? "Done" : "Open"}</div><small>{lead.nextVisitDate || lead.scheduledDate || "Not scheduled"}</small></div><div className="detail-box"><div className="detail-label">Started</div><div className="detail-value">{clock(lead.visitStartedAt)}</div><small>Employee record</small></div><div className="detail-box"><div className="detail-label">Finished</div><div className="detail-value">{clock(lead.visitFinishedAt)}</div><small>{formatDuration(lead.visitDurationSeconds || 0)}</small></div></div></section>}

    {tab === "history" && <section className="card profile-card service-history-card"><div className="table-head service-history-head"><div><h2>Service history</h2><p className="section-intro">Every service completed for this property while assigned to this company.</p></div><span className="pill history-count-pill">{visits.length} visits</span></div><div className="property-visit-history">{visits.map((visit) => { const open = expandedVisitIds.includes(visit.id); return <article key={visit.id} className={open ? "history-visit open" : "history-visit"}><button type="button" className="history-visit-summary" onClick={() => toggleVisit(visit.id)} aria-expanded={open}><div><small>{new Date(`${visit.scheduled_date}T12:00:00`).toLocaleDateString()}</small><strong>{visit.service_name}</strong></div><span className="history-visit-status">{visit.status}</span><b aria-hidden="true">{open ? "⌃" : "⌄"}</b></button>{open && <div className="history-visit-body"><div className="property-visit-meta"><span>Started <strong>{clock(visit.started_at)}</strong></span><span>Finished <strong>{clock(visit.finished_at)}</strong></span><span>Duration <strong>{formatDuration(visit.duration_seconds || 0)}</strong></span></div><p>{visit.customer_visible_summary || visit.employee_notes || "No completion notes recorded."}</p>{visit.photos.length ? <div className="property-visit-photos">{visit.photos.map((photo) => <figure key={photo.id}><img src={photo.url} alt={photo.caption || `${visit.service_name} ${photo.type}`} /><figcaption>{photo.caption || photo.type}</figcaption></figure>)}</div> : <div className="property-no-images">No service photos for this visit</div>}</div>}</article> })}{!visits.length && <div className="empty-state"><strong>No service history yet.</strong><p>Completed visits for this company will appear here.</p></div>}</div></section>}
  </AdminShell>;
}
