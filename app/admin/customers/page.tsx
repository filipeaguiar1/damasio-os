"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { useCustomerProperties } from "@/lib/hooks/useCustomerProperties";

const lawnOrder:Record<string,number>={xs:1,small:2,legacy:3,oversize:4};

export default function Customers(){
  const { records, loading, error, refresh } = useCustomerProperties();
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("all");
  const [city,setCity]=useState("all");
  const [sort,setSort]=useState("city");
  const cities=useMemo(()=>[...new Set(records.map(r=>r.city).filter(Boolean))].sort(),[records]);
  const visible=useMemo(()=>records.filter(r=>{
    const hay=`${r.fullName} ${r.addressLine1} ${r.city} ${r.phone||""} ${r.email||""} ${r.lotSize||""} ${r.grassHeight||""}`.toLowerCase();
    const matches=!query||hay.includes(query.toLowerCase());
    if(!matches)return false;
    if(city!=="all"&&r.city!==city)return false;
    if(filter==="missing-phone")return !r.phone;
    if(filter==="missing-email")return !r.email;
    if(filter==="access")return Boolean(r.accessNotes||r.gate||r.dog);
    if(filter==="big-lawn")return r.lotSize==="legacy"||r.lotSize==="oversize";
    if(filter==="high-grass")return r.grassHeight==="4in"||r.grassHeight==="5in";
    if(filter==="with-notes")return Boolean(r.customerNotes||r.accessNotes||r.propertyNotes);
    return true;
  }).sort((a,b)=>{
    if(sort==="lawn")return (lawnOrder[a.lotSize||""]||9)-(lawnOrder[b.lotSize||""]||9)||a.city.localeCompare(b.city)||a.addressLine1.localeCompare(b.addressLine1);
    if(sort==="grass")return String(a.grassHeight||"").localeCompare(String(b.grassHeight||""))||a.city.localeCompare(b.city);
    return a.city.localeCompare(b.city)||a.addressLine1.localeCompare(b.addressLine1);
  }),[records,query,filter,city,sort]);
  const grouped=useMemo(()=>visible.reduce<Record<string,typeof visible>>((acc,r)=>{const k=r.city||"No city";(acc[k] ||= []).push(r);return acc;},{}),[visible]);

  return <AdminShell active="Customers">
    <div className="app-top">
      <div>
        <span className="eyebrow">V42.8.1 Practical Filters</span>
        <h1>Customers</h1>
        <p className="section-intro">Quick filters now focus on route decisions: city, lawn size, grass height, access and missing contact info.</p>
      </div>
      <div className="toolbar-inline">
        <input className="input" placeholder="Search customer, city, lawn..." value={query} onChange={e=>setQuery(e.target.value)} />
        <CompactFilter label="Useful filters"><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All</label><label><input type="radio" checked={filter==="big-lawn"} onChange={()=>setFilter("big-lawn")}/> Big lawns</label><label><input type="radio" checked={filter==="high-grass"} onChange={()=>setFilter("high-grass")}/> High grass</label><label><input type="radio" checked={filter==="access"} onChange={()=>setFilter("access")}/> Gate / dog / access</label><label><input type="radio" checked={filter==="missing-phone"} onChange={()=>setFilter("missing-phone")}/> Missing phone</label><label><input type="radio" checked={filter==="missing-email"} onChange={()=>setFilter("missing-email")}/> Missing email</label><label><input type="radio" checked={filter==="with-notes"} onChange={()=>setFilter("with-notes")}/> Has notes</label><hr/><label>City<select className="input" value={city} onChange={e=>setCity(e.target.value)}><option value="all">All cities</option>{cities.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Order<select className="input" value={sort} onChange={e=>setSort(e.target.value)}><option value="city">City / address</option><option value="lawn">Lawn size</option><option value="grass">Grass height</option></select></label></CompactFilter>
        <Link className="btn btn-outline" href="/admin/add-client">Add Client</Link>
        <button className="btn btn-primary" onClick={refresh}>Refresh</button>
      </div>
    </div>

    <div className="stats v19-stats">
      <div className="card dash-card"><div className="mini-label">Visible</div><div className="mini-value">{visible.length}</div></div>
      <div className="card dash-card"><div className="mini-label">Cities</div><div className="mini-value">{Object.keys(grouped).length}</div></div>
      <div className="card dash-card"><div className="mini-label">Total Synced</div><div className="mini-value">{records.length}</div></div>
    </div>

    {error && <div className="payment-message" style={{marginBottom:16}}>Using local operational sync. Supabase note: {error}</div>}

    <section className="card table-card">
      <div className="table-head"><div><h2>Customer Directory</h2><p className="section-intro">Grouped by city to reduce search time.</p></div><span className="sync-note">{filter} · {city} · {sort}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Customer</th><th>Property</th><th>Contact</th><th>Lawn</th><th>Access</th><th>Open</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}>Loading synced records...</td></tr>}
            {!loading && visible.length===0 && <tr><td colSpan={6}>No customers match this filter.</td></tr>}
            {!loading && Object.entries(grouped).map(([group,rows])=><Fragment key={group}>
              <tr key={group}><td colSpan={6}><strong>{group}</strong> · {rows.length} customer(s)</td></tr>
              {rows.map(r=><tr key={r.propertyId}>
                <td><strong>{r.fullName}</strong><br/><small>{r.customerNotes || "No customer notes"}</small></td>
                <td>{r.addressLine1}, {r.city}<br/><small>{r.province} {r.postalCode || ""}</small></td>
                <td>{r.phone || "—"}<br/><small>{r.email || "—"}</small></td>
                <td>{r.lotSize || "—"}<br/><small>{r.grassHeight || "—"}</small></td>
                <td>{r.accessNotes || "—"}<br/><small>{r.gate ? "Gate" : "No gate"}{r.dog ? " · Dog" : ""}</small></td>
                <td><Link className="btn btn-small btn-outline" href={`/admin/customers/${r.propertyId}?tab=service-screen`}>Open</Link></td>
              </tr>)}
            </Fragment>)}
          </tbody>
        </table>
      </div>
    </section>
  </AdminShell>
}
