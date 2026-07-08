"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {calculateVisitStatus,DAMASIO_SYNC_EVENT,getEmployeeTasks,getLeads,getRegionFromAddress,Lead,seedDemoLeads,seedEmployeeTasks,simulateCustomerServiceComplete,unassignHomes} from "@/lib/storage";

type AlertTab="all"|"return-visits"|"pending-payments"|"low-reviews"|"completed"|"booked"|"upcoming"|"overdue";
const tabs:{id:AlertTab;label:string;hint:string}[]=[
  {id:"all",label:"All",hint:"Everything needing attention"},
  {id:"return-visits",label:"Return Visits",hint:"Issues created by the field"},
  {id:"pending-payments",label:"Pending Payments",hint:"Admin finance follow-up"},
  {id:"low-reviews",label:"Low Reviews",hint:"Feedback below 3 stars"},
  {id:"completed",label:"Completed",hint:"Review finished work"},
  {id:"booked",label:"Booked",hint:"Already assigned / published"},
  {id:"upcoming",label:"Needs Booking Soon",hint:"Coming soon but not assigned"},
  {id:"overdue",label:"Overdue",hint:"Late visits to resolve"},
];
function niceDate(v?:string){return v?new Date(v+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}):"No date"}
function statusLabel(l:Lead){const s=calculateVisitStatus(l);return s==="upcoming"?"Needs Booking Soon":s[0].toUpperCase()+s.slice(1)}

export default function Alerts(){
  const[active,setActive]=useState<AlertTab>("all");
  const[leads,setLeads]=useState<Lead[]>([]);
  const[tasks,setTasks]=useState(getEmployeeTasks());
  function refresh(){setLeads(getLeads());setTasks(getEmployeeTasks())}
  useEffect(()=>{seedDemoLeads();refresh();const on=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const q=(params.get("tab")||params.get("status")||"all") as AlertTab;if(tabs.some(t=>t.id===q))setActive(q)},[]);

  const buckets=useMemo(()=>{
    const returnVisits=tasks.filter(t=>t.status!=="resolved");
    const pendingPayments=leads.filter(l=>l.paymentStatus==="pending");
    const lowReviews=leads.filter(l=>(l.feedback?.rating||5)<3);
    const completed=leads.filter(l=>calculateVisitStatus(l)==="completed");
    const booked=leads.filter(l=>calculateVisitStatus(l)==="booked");
    const upcoming=leads.filter(l=>calculateVisitStatus(l)==="upcoming");
    const overdue=leads.filter(l=>calculateVisitStatus(l)==="overdue");
    return{returnVisits,pendingPayments,lowReviews,completed,booked,upcoming,overdue};
  },[leads,tasks]);
  const selectedLeads=active==="completed"?buckets.completed:active==="booked"?buckets.booked:active==="upcoming"?buckets.upcoming:active==="overdue"?buckets.overdue:active==="pending-payments"?buckets.pendingPayments:active==="low-reviews"?buckets.lowReviews:[];

  return <AdminShell active="Alerts">
    <div className="app-top"><div><span className="eyebrow">Resolution Hub</span><h1>Alert Center</h1><p className="section-intro">Every card is clickable and opens the exact list the Admin needs to resolve.</p></div><button className="btn btn-primary" onClick={()=>{seedDemoLeads(true);seedEmployeeTasks();refresh()}}>Load Demo</button></div>

    <div className="grid-3">
      <button className="card profile-card alert-card action-card" onClick={()=>setActive("return-visits")}><h2>Return Visits</h2><div className="mini-value">{buckets.returnVisits.length}</div><p>Open issues from Employees.</p></button>
      <button className="card profile-card alert-card action-card" onClick={()=>setActive("pending-payments")}><h2>Pending Payments</h2><div className="mini-value">{buckets.pendingPayments.length}</div><p>Admin-only finance follow-up.</p></button>
      <button className="card profile-card alert-card action-card" onClick={()=>setActive("low-reviews")}><h2>Low Reviews</h2><div className="mini-value">{buckets.lowReviews.length}</div><p>Customers needing attention.</p></button>
    </div>

    <div className="status-strip" style={{marginTop:18}}>
      <button className="status-chip green" onClick={()=>setActive("completed")}><b>{buckets.completed.length}</b><span>Completed</span></button>
      <button className="status-chip blue" onClick={()=>setActive("booked")}><b>{buckets.booked.length}</b><span>Booked</span></button>
      <button className="status-chip yellow" onClick={()=>setActive("upcoming")}><b>{buckets.upcoming.length}</b><span>Needs booking soon</span></button>
      <button className="status-chip red" onClick={()=>setActive("overdue")}><b>{buckets.overdue.length}</b><span>Overdue</span></button>
    </div>

    <section className="card table-card" style={{marginTop:20}}>
      <div className="table-head"><div><h2>{tabs.find(t=>t.id===active)?.label}</h2><p className="section-intro">{tabs.find(t=>t.id===active)?.hint}</p></div><div className="tab-row">{tabs.map(t=><button key={t.id} className={active===t.id?"tab active":"tab"} onClick={()=>setActive(t.id)}>{t.label}</button>)}</div></div>

      {active==="all"&&<div className="resolution-grid">
        <button className="resolution-card" onClick={()=>setActive("overdue")}><span className="dot overdue"></span><strong>Fix overdue visits</strong><small>{buckets.overdue.length} late visit(s)</small></button>
        <button className="resolution-card" onClick={()=>setActive("upcoming")}><span className="dot upcoming"></span><strong>Book upcoming homes</strong><small>{buckets.upcoming.length} need booking soon</small></button>
        <button className="resolution-card" onClick={()=>setActive("return-visits")}><span className="dot overdue"></span><strong>Resolve return jobs</strong><small>{buckets.returnVisits.length} open issue(s)</small></button>
        <button className="resolution-card" onClick={()=>setActive("pending-payments")}><span className="dot booked"></span><strong>Payment follow-up</strong><small>{buckets.pendingPayments.length} pending only</small></button>
      </div>}

      {active==="return-visits"&&<div className="route-list-preview">{buckets.returnVisits.map(t=><Link className="route-item large" key={t.id} href={`/admin/customers/${t.leadId}?tab=service-screen`}><span>!</span><div><strong>{t.customer}</strong><p>{t.address} • Reason: {t.description}</p><small>Return date: {niceDate(t.scheduledDate)} • Assigned: {t.assignedTo}</small></div><small>{t.priority}</small></Link>)}{!buckets.returnVisits.length&&<p className="section-intro">No return visits open.</p>}</div>}

      {selectedLeads.length>0&&<div className="route-list-preview">{selectedLeads.map(l=><div className="route-item large" key={l.id}><span className={`dot ${calculateVisitStatus(l)}`}></span><div><strong>{l.name}</strong><p>{l.address} • {getRegionFromAddress(l.address)} • {niceDate(l.nextVisitDate||l.scheduledDate)}</p></div><div className="inline-actions"><Link href={`/admin/customers/${l.id}?tab=service-screen`} className="btn btn-small">Open</Link>{(active==="overdue"||active==="upcoming")&&<Link href="/admin/customers" className="btn btn-small btn-outline">Assign</Link>}{active==="booked"&&<button className="btn btn-small btn-outline" onClick={()=>{unassignHomes([l.id]);refresh()}}>Return</button>}{active==="booked"&&<button className="btn btn-small" onClick={()=>{simulateCustomerServiceComplete(l.id);refresh()}}>Mark done</button>}<small>{statusLabel(l)}</small></div></div>)}</div>}

      {(active==="pending-payments"||active==="low-reviews")&&selectedLeads.length===0&&<p className="section-intro">Nothing in this section right now.</p>}
      {!["all","return-visits","pending-payments","low-reviews"].includes(active)&&selectedLeads.length===0&&<p className="section-intro">No homes in this status.</p>}
    </section>
  </AdminShell>
}
