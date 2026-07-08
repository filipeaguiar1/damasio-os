"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DAMASIO_SYNC_EVENT, getEmployeeTasks, getLeads, getNotifications, seedDemoLeads } from "@/lib/storage";

export default function MobileAdminApp(){
  const [refreshKey,setRefreshKey]=useState(0);
  useMobileRealtime(()=>setRefreshKey(v=>v+1));
  useEffect(()=>{seedDemoLeads(); const on=()=>setRefreshKey(v=>v+1); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); const t=window.setInterval(on,5000); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);window.clearInterval(t)}},[]);
  const data=useMemo(()=>{
    refreshKey;
    const leads=getLeads(); const tasks=getEmployeeTasks(); const notes=getNotifications();
    return {leads,tasks,notes,open:leads.filter(l=>l.status!=="completed").length,done:leads.filter(l=>l.status==="completed").length,returnVisits:tasks.filter(t=>t.status!=="resolved").length,alerts:notes.filter(n=>!n.read).length};
  },[refreshKey]);
  return <main className="mobile-app-shell">
    <header className="mobile-topbar"><Link href="/mobile" className="mobile-back">‹</Link><div><strong>Admin Mobile</strong><span>Command snapshot</span></div><div className="mobile-avatar">A</div></header>
    <section className="mobile-hero-card compact"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>Today</strong><span>Live operations</span></div></div><h1>{data.open} open homes</h1><p>Simple view for quick mobile decisions. Full editing stays in Admin desktop when needed.</p></section>
    <section className="mobile-stats-card"><div><span>Open</span><strong>{data.open}</strong><small>homes</small></div><div><span>Done</span><strong>{data.done}</strong><small>today</small></div><div><span>Tasks</span><strong>{data.returnVisits}</strong><small>return</small></div></section>
    <section className="mobile-card-list">
      <Link className="mobile-admin-action" href="/admin/command"><strong>Command Center</strong><p>Open full operations dashboard.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/routes"><strong>Dispatch / Routes</strong><p>Manage assignments and route order.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/tasks"><strong>Return Visits</strong><p>Assign, unassign and resolve tasks.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/customers"><strong>Customers</strong><p>Search customer and property data.</p><span>›</span></Link>
    </section>
    <section className="mobile-card-list"><h2 className="mobile-section-title">Needs attention</h2>{data.tasks.filter(t=>t.status!=="resolved").slice(0,5).map(t=><article className="mobile-issue-card" key={t.id}><strong>{t.title}</strong><p>{t.customer}<br/>{t.address}</p><small>Status: {t.status}</small></article>)}</section>
  </main>
}
