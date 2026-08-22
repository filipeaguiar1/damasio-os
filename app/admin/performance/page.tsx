"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDuration, getLeads, getSessions, Lead, seedDemoLeads } from "@/lib/storage";

export default function PerformancePage(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [sessions,setSessions]=useState(getSessions());
  function refresh(){setLeads(getLeads());setSessions(getSessions())}
  useEffect(()=>refresh(),[]);
  const ratings=leads.filter(l=>l.feedback);
  const avg=ratings.length?ratings.reduce((s,l)=>s+(l.feedback?.rating||0),0)/ratings.length:0;
  const tips=ratings.reduce((s,l)=>s+(l.feedback?.tipAmount||0),0);
  const completedSessions=sessions.filter(s=>s.status==="finished"&&s.durationSeconds);
  const avgSeconds=completedSessions.length?Math.round(completedSessions.reduce((s,x)=>s+(x.durationSeconds||0),0)/completedSessions.length):0;
  return <AdminShell active="Performance">
    <div className="app-top"><div><span className="eyebrow">OPERATIONS REPORTING</span><h1>Employee Performance</h1><p className="section-intro">Ratings, tips, service time and field proof in one operational report.</p></div><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><Link className="btn btn-primary" href="/admin/performance/simulator">Open Simulator</Link><button className="btn btn-outline" onClick={()=>{seedDemoLeads(true);refresh()}}>Load Demo</button></div></div>
    <div className="performance-grid"><div className="card dash-card"><div className="mini-label">Avg Rating</div><div className="mini-value">{avg?`${avg.toFixed(1)} / 5`:"—"}</div></div><div className="card dash-card"><div className="mini-label">Tips</div><div className="mini-value">${tips.toFixed(2)}</div></div><div className="card dash-card"><div className="mini-label">Avg Time</div><div className="mini-value">{avgSeconds?formatDuration(avgSeconds):"—"}</div></div><div className="card dash-card"><div className="mini-label">Field Photos</div><div className="mini-value">{leads.reduce((s,l)=>s+(l.photos?.length||0),0)}</div></div></div>
    <section className="card table-card" style={{marginTop:20}}><div className="table-head"><div><h2>Completed service performance</h2><p className="section-intro">Compare service duration and customer feedback by employee or crew.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee/Crew</th><th>Customer</th><th>Started</th><th>Finished</th><th>Duration</th><th>Rating</th><th>Tip</th></tr></thead><tbody>{leads.length===0?<tr><td colSpan={7}>No performance data yet.</td></tr>:leads.map(l=>{const session=sessions.find(s=>s.leadId===l.id);return <tr key={l.id}><td>{l.assignedCrew||session?.crew||"Crew A"}</td><td>{l.name}<br/>{l.address}</td><td>{session?.startedAt?new Date(session.startedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}):"-"}</td><td>{session?.finishedAt?new Date(session.finishedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}):"-"}</td><td>{session?.durationSeconds?formatDuration(session.durationSeconds):"-"}</td><td>{l.feedback?`${l.feedback.rating} / 5`:"-"}</td><td>{l.feedback?`$${l.feedback.tipAmount}`:"-"}</td></tr>})}</tbody></table></div></section>
  </AdminShell>
}