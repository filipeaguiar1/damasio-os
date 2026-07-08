"use client";

import { useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { useCustomerProperties } from "@/lib/hooks/useCustomerProperties";

export default function PropertiesPage(){
  const { records, loading, error, refresh } = useCustomerProperties();
  const [filter,setFilter]=useState("all");
  const visible=useMemo(()=>records.filter(r=>filter==="all"?true:filter==="needs-access"?!r.accessNotes:filter==="access"?Boolean(r.accessNotes||r.gate):filter==="large"?r.lotSize==="legacy"||r.lotSize==="oversize":filter==="notes"?Boolean(r.accessNotes||r.propertyNotes):true),[records,filter]);
  return <AdminShell active="Properties">
    <div className="app-top"><div><span className="eyebrow">V42.7.5 Synced Properties</span><h1>Properties</h1><p className="section-intro">Properties now stay available for Dispatch after creation.</p></div><div className="toolbar-inline"><CompactFilter label="Find properties fast"><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All properties</label><label><input type="radio" checked={filter==="needs-access"} onChange={()=>setFilter("needs-access")}/> Missing access notes</label><label><input type="radio" checked={filter==="access"} onChange={()=>setFilter("access")}/> Gate/access</label><label><input type="radio" checked={filter==="large"} onChange={()=>setFilter("large")}/> Large lots</label><label><input type="radio" checked={filter==="notes"} onChange={()=>setFilter("notes")}/> Has notes</label></CompactFilter><button className="btn btn-primary" onClick={refresh}>Refresh</button></div></div>
    {error && <div className="payment-message" style={{marginBottom:16}}>Using local operational sync. Supabase note: {error}</div>}
    {loading ? <div className="card profile-card"><h3>Loading properties...</h3></div> : <div className="grid-3">{visible.map(r=><div className="card profile-card" key={r.propertyId}><h3>{r.addressLine1}</h3><p><strong>Customer:</strong> {r.fullName}</p><p><strong>Location:</strong> {r.city}, {r.province}</p><div className="detail-grid"><div className="detail-box"><div className="detail-label">Lawn</div><div className="detail-value">{r.lotSize || "—"}</div></div><div className="detail-box"><div className="detail-label">Grass</div><div className="detail-value">{r.grassHeight || "—"}</div></div></div>{r.accessNotes&&<div className="property-alert">{r.accessNotes}</div>}<p><strong>Gate:</strong> {r.gate ? "Yes" : "No"}</p><p><strong>Dog:</strong> {r.dog ? "Yes" : "No"}</p></div>)}{visible.length===0&&<div className="card profile-card"><h3>No properties match this filter.</h3></div>}</div>}
  </AdminShell>
}
