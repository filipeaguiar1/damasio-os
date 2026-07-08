"use client";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getChecklists, getLeads, getTodayKey, Lead, seedDemoLeads } from "@/lib/storage";

export default function TodayPage(){
  const [leads,setLeads]=useState<Lead[]>([]);
  useEffect(()=>setLeads(getLeads()),[]);
  const today=getTodayKey();
  const todayJobs=leads.filter(l=>l.scheduledDate===today||l.status==="booked");
  const checklists=getChecklists().filter(c=>c.date===today);
  const projected=todayJobs.reduce((s,l)=>s+l.total,0);
  return <AdminShell active="Today">
    <div className="app-top"><div><span className="eyebrow">Daily Command Center</span><h1>Today</h1><p className="section-intro">Daily jobs, projected revenue, checklist confirmations and follow-ups.</p></div><button className="btn btn-primary" onClick={()=>{seedDemoLeads(true);setLeads(getLeads())}}>Load Demo</button></div>
    <div className="stats"><div className="card dash-card"><div className="mini-label">Jobs Today</div><div className="mini-value">{todayJobs.length}</div></div><div className="card dash-card"><div className="mini-label">Projected</div><div className="mini-value">${projected.toFixed(0)}</div></div><div className="card dash-card"><div className="mini-label">Checklists</div><div className="mini-value">{checklists.length}</div></div><div className="card dash-card"><div className="mini-label">Follow-ups</div><div className="mini-value">{leads.filter(l=>l.status==="quoted"||l.status==="new").length}</div></div></div>
    <section className="card table-card"><div className="table-head"><h2>Jobs / Booked Services</h2></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Date</th><th>Crew</th><th>Total</th></tr></thead><tbody>{todayJobs.map(l=><tr key={l.id}><td>{l.name}<br/>{l.address}</td><td>{l.service}</td><td>{l.scheduledDate||"Booked"}</td><td>{l.assignedCrew||"Unassigned"}</td><td>${l.total.toFixed(2)}</td></tr>)}</tbody></table></div></section>
  </AdminShell>
}
