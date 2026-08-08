"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { useCustomerProperties } from "@/lib/hooks/useCustomerProperties";
import { deleteCustomers } from "@/lib/services/customerPropertyService";
import { loadSchedulingDispatchBoard } from "@/lib/services/schedulingService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const lawnOrder: Record<string, number> = { xs: 1, small: 2, legacy: 3, oversize: 4 };
type Offer = { id:string; fullName:string; payout:number; sentAt?:string|null; note?:string|null; property?:{id:string;address_line1:string;city:string;province:string;postal_code?:string|null;official_photo_url?:string|null}|null };

async function token() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token) throw new Error("Your Admin session expired.");
  return data.session.access_token;
}

export default function Customers() {
  const {
    records, loading, error, refresh, pagination, query, city,
    setQuery, setCity, nextPage, previousPage,
  } = useCustomerProperties();
  const [offers,setOffers]=useState<Offer[]>([]);
  const [filter,setFilter]=useState("all");
  const [sort,setSort]=useState("city");
  const [selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [today,setToday]=useState({homes:0,completed:0,tasks:0,tasksCompleted:0});

  async function loadOffers(){
    try{
      const response=await fetch("/api/admin/customer-offers",{headers:{authorization:`Bearer ${await token()}`},cache:"no-store"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Offers could not be loaded.");
      setOffers(result.offers||[]);
    }catch(error){setMessage(error instanceof Error?error.message:"Offers could not be loaded.")}
  }

  useEffect(()=>{void loadOffers();let alive=true;async function sync(){try{const board=await loadSchedulingDispatchBoard();const date=new Date();const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;const visits=board.visits.filter(v=>v.scheduledDate===key&&!['cancelled','missed'].includes(v.status));const tasks=board.tasks.filter(t=>t.scheduledDate===key);if(alive)setToday({homes:visits.length,completed:visits.filter(v=>v.status==='completed').length,tasks:tasks.length,tasksCompleted:tasks.filter(t=>['completed','resolved'].includes(t.status)).length});}catch{}}void sync();const timer=setInterval(sync,60000);return()=>{alive=false;clearInterval(timer)}},[]);

  const cities=useMemo(()=>[...new Set(records.map(r=>r.city).filter(Boolean))].sort(),[records]);
  const visible=useMemo(()=>records.filter(r=>{if(filter==="platform")return r.lockedByPlatform;if(filter==="company")return !r.lockedByPlatform;if(filter==="missing-phone")return !r.phone;if(filter==="missing-email")return !r.email;if(filter==="access")return Boolean(r.accessNotes||r.gate||r.dog);if(filter==="big-lawn")return r.lotSize==="legacy"||r.lotSize==="oversize";if(filter==="high-grass")return r.grassHeight==="4in"||r.grassHeight==="5in";if(filter==="with-notes")return Boolean(r.customerNotes||r.accessNotes||r.propertyNotes);return true;}).sort((a,b)=>sort==="lawn"?(lawnOrder[a.lotSize||""]||9)-(lawnOrder[b.lotSize||""]||9)||a.city.localeCompare(b.city):sort==="grass"?String(a.grassHeight||"").localeCompare(String(b.grassHeight||""))||a.city.localeCompare(b.city):a.city.localeCompare(b.city)||a.addressLine1.localeCompare(b.addressLine1)),[records,filter,sort]);
  const grouped=useMemo(()=>visible.reduce<Record<string,typeof visible>>((acc,r)=>{const k=r.city||"No city";(acc[k] ||= []).push(r);return acc},{}),[visible]);
  const editableIds=useMemo(()=>[...new Set(visible.filter(r=>!r.lockedByPlatform).map(r=>r.customerId))],[visible]);
  const allVisibleSelected=editableIds.length>0&&editableIds.every(id=>selected.includes(id));
  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}
  function toggleAll(){setSelected(current=>allVisibleSelected?current.filter(id=>!editableIds.includes(id)):[...new Set([...current,...editableIds])])}
  async function remove(ids:string[],label:string){if(!ids.length||!window.confirm(`Remove ${label} from active customers?`))return;setBusy(true);try{const total=await deleteCustomers(ids);setSelected(current=>current.filter(id=>!ids.includes(id)));await refresh();setMessage(`${total} customer(s) removed.`)}catch(error){setMessage(error instanceof Error?error.message:"Customers could not be removed.")}finally{setBusy(false)}}
  async function reload(){await Promise.all([refresh(),loadOffers()])}

  return <AdminShell active="Customers">
    <div className="app-top customer-directory-head"><div><span className="eyebrow">CUSTOMER OWNERSHIP CONTROL</span><h1>Customers</h1><p className="section-intro">Pending platform offers stay separate until you accept them.</p></div><div className="toolbar-inline"><input className="input" placeholder="Search customer, city, lawn..." value={query} onChange={e=>setQuery(e.target.value)} /><CompactFilter label="Useful filters"><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All</label><label><input type="radio" checked={filter==="company"} onChange={()=>setFilter("company")}/> Company-owned</label><label><input type="radio" checked={filter==="platform"} onChange={()=>setFilter("platform")}/> Platform customers</label><hr/><label>City<select className="input" value={city} onChange={e=>setCity(e.target.value)}><option value="all">All cities</option>{cities.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Order<select className="input" value={sort} onChange={e=>setSort(e.target.value)}><option value="city">City / address</option><option value="lawn">Lawn size</option><option value="grass">Grass height</option></select></label></CompactFilter><Link className="btn btn-primary" href="/admin/add-client">＋ Add Customer</Link><button className="btn btn-danger" disabled={busy||selected.length===0} onClick={()=>void remove(selected,`${selected.length} selected customer(s)`)}>Delete Selected ({selected.length})</button><button className="btn btn-primary" onClick={()=>void reload()}>Refresh</button></div></div>

    {offers.length>0&&<section className="card table-card" style={{marginBottom:20,borderColor:"#d8a73d"}}><div className="table-head"><div><h2>Customer offers</h2><p className="section-intro">Review the payout before the customer enters your company records.</p></div><span className="pill">{offers.length} pending</span></div><div className="table-wrap"><table><thead><tr><th>Property</th><th>Customer</th><th>Company payout</th><th>Sent</th><th>Action</th></tr></thead><tbody>{offers.map(offer=><tr key={offer.id}><td><strong>{offer.property?.address_line1||"Address not set"}</strong><br/><small>{[offer.property?.city,offer.property?.province,offer.property?.postal_code].filter(Boolean).join(", ")}</small></td><td>{offer.fullName}<br/><small>Contact protected until accepted</small></td><td><strong>${offer.payout.toFixed(2)} CAD</strong><br/><small>{offer.note||"Platform service offer"}</small></td><td>{offer.sentAt?new Date(offer.sentAt).toLocaleString("en-CA"):"—"}</td><td><Link className="btn btn-primary" href={`/admin/customers/${offer.property?.id||offer.id}`}>Review offer</Link></td></tr>)}</tbody></table></div></section>}

    <div className="stats v19-stats customer-directory-stats"><div className="card dash-card"><div className="mini-label">Today's homes</div><div className="mini-value">{today.completed}/{today.homes}</div></div><div className="card dash-card"><div className="mini-label">Today's tasks</div><div className="mini-value">{today.tasksCompleted}/{today.tasks}</div></div><div className="card dash-card"><div className="mini-label">Pending offers</div><div className="mini-value">{offers.length}</div></div><div className="card dash-card"><div className="mini-label">Active customers</div><div className="mini-value">{pagination.total}</div></div></div>
    {error&&<div className="payment-message" style={{marginBottom:16}}>{error}</div>}{message&&<div className="payment-message" style={{marginBottom:16}}>{message}</div>}
    <section className="card table-card customer-directory-card"><div className="table-head"><div><h2>Accepted customer directory</h2><p className="section-intro">Only accepted platform customers and company-created customers appear here.</p></div><span className="sync-note">Page {pagination.page} of {pagination.pageCount} · {pagination.total} properties</span></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}/></th><th>Customer</th><th>Property</th><th>Contact</th><th>Ownership</th><th>Lawn</th><th>Actions</th></tr></thead><tbody>{loading&&<tr><td colSpan={7}>Loading synced records...</td></tr>}{!loading&&visible.length===0&&<tr><td colSpan={7}>No customers match this filter.</td></tr>}{!loading&&Object.entries(grouped).map(([group,rows])=><Fragment key={group}><tr><td colSpan={7}><strong>{group}</strong> · {rows.length} customer(s)</td></tr>{rows.map(r=><tr key={r.propertyId}><td><input type="checkbox" disabled={r.lockedByPlatform} checked={selected.includes(r.customerId)} onChange={()=>toggle(r.customerId)} /></td><td><div className="customer-directory-person"><div>{r.officialPhotoUrl?<img src={r.officialPhotoUrl} alt={r.fullName}/>:<span>⌂</span>}</div><p><strong>{r.fullName}</strong><small>{r.customerNotes||"No customer notes"}</small></p></div></td><td>{r.addressLine1}, {r.city}<br/><small>{r.province} {r.postalCode||""}</small></td><td>{r.lockedByPlatform?<>Protected<br/><small>Platform customer</small></>:<>{r.phone||"—"}<br/><small>{r.email||"—"}</small></>}</td><td>{r.lockedByPlatform?<span className="pill">Platform managed</span>:<span className="pill">Company-owned</span>}</td><td>{r.lotSize||"—"}<br/><small>{r.grassHeight||"—"}</small></td><td><div className="row">{r.lockedByPlatform?<Link className="btn btn-small btn-outline" href={`/admin/customers/${r.propertyId}`}>Open</Link>:<><Link className="btn btn-small btn-primary" href={`/admin/customers/${r.propertyId}/edit`}>Edit</Link><Link className="btn btn-small btn-outline" href={`/admin/customers/${r.propertyId}?tab=property`}>History</Link><button className="btn btn-small btn-danger" disabled={busy} onClick={()=>void remove([r.customerId],r.fullName)}>Delete</button></>}</div></td></tr>)}</Fragment>)}</tbody></table></div><div className="table-head" style={{borderTop:"1px solid #e5ece8"}}><span className="section-intro">Showing up to {pagination.pageSize} records per page.</span><div className="row"><button className="btn btn-outline" disabled={loading||!pagination.hasPrevious} onClick={previousPage}>Previous</button><button className="btn btn-primary" disabled={loading||!pagination.hasNext} onClick={nextPage}>Next</button></div></div></section>
  </AdminShell>;
}