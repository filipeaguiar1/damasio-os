"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DAMASIO_SYNC_EVENT, getLeads, saveFeedback, seedDemoLeads } from "@/lib/storage";

export default function MobileCustomerApp(){
  const [refreshKey,setRefreshKey]=useState(0);
  const [message,setMessage]=useState("");
  useMobileRealtime(()=>setRefreshKey(v=>v+1));
  useEffect(()=>{seedDemoLeads(); const on=()=>setRefreshKey(v=>v+1); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);
  const lead=useMemo(()=>{refreshKey; return getLeads()[0]||null},[refreshKey]);
  function feedback(rating:number){if(!lead)return; saveFeedback(lead.id,{rating,comment:rating>=4?"Everything looks good from mobile app.":"Please check this service.",tipAmount:0,tipMethod:"etransfer",recommend:rating>=4?"yes":"maybe",createdAt:new Date().toISOString()}); setMessage("Feedback sent. Thank you."); setRefreshKey(v=>v+1)}
  return <main className="mobile-app-shell">
    <header className="mobile-topbar"><Link href="/mobile" className="mobile-back">‹</Link><div><strong>Customer Mobile</strong><span>Service status</span></div><div className="mobile-avatar">C</div></header>
    {!lead?<section className="mobile-empty"><strong>No property found.</strong><p>Load demo or connect customer account.</p></section>:<>
      <section className="mobile-hero-card compact"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>{lead.name}</strong><span>{lead.service}</span></div></div><h1>{lead.status==="completed"?"Service completed":"Service scheduled"}</h1><p>{lead.address}</p></section>
      <section className="mobile-card-list">
        <article className="mobile-issue-card"><strong>Next visit</strong><p>{lead.nextVisitDate||lead.scheduledDate||"To be confirmed"}</p><small>Status: {lead.status}</small></article>
        <article className="mobile-issue-card"><strong>Feedback</strong><p>{lead.feedback?`Rating: ${lead.feedback.rating}/5`:"After the visit, tell us how it went."}</p><div className="mobile-rating-row"><button onClick={()=>feedback(5)}>★★★★★</button><button onClick={()=>feedback(3)}>Needs review</button></div></article>
        <Link className="mobile-admin-action" href="/customer"><strong>Open Customer Portal</strong><p>Full portal with history and return visit request.</p><span>›</span></Link>
      </section>
      {message&&<p className="mobile-message">{message}</p>}
    </>}
  </main>
}
