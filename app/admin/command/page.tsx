"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {DAMASIO_CREWS,DAMASIO_SYNC_EVENT,Lead,ActivityLog,calculateVisitStatus,getActivityLogs,getEmployeeTasks,getExpenses,getInvoices,getLeads,getNotifications,getOperationsIntelligence,getPendingReviewCount,getSessions,getWorkflowEvents,seedDemoExpenses,seedDemoLeads,seedEmployeeTasks} from "@/lib/storage";

function money(n:number){return `$${n.toLocaleString(undefined,{maximumFractionDigits:0})}`}
function todayKey(){return new Date().toISOString().slice(0,10)}
function serviceHref(id:string){return `/employee/property/${id}?admin=1`}

export default function Command(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[tick,setTick]=useState(0);
  const[selectedLog,setSelectedLog]=useState<ActivityLog|null>(null);
  function refresh(){setLeads(getLeads());setTick(v=>v+1)}
  useEffect(()=>{seedDemoLeads();refresh();const on=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);const t=setInterval(refresh,5000);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);clearInterval(t)}},[]);
  function seed(){seedDemoLeads(true);seedEmployeeTasks();seedDemoExpenses();refresh()}

  const data=useMemo(()=>{
    const today=todayKey();
    const sessions=getSessions();
    const tasks=getEmployeeTasks();
    const invoices=getInvoices();
    const expenses=getExpenses();
    const openTasks=tasks.filter(t=>!["resolved","completed"].includes(t.status));
    const adminReviewTasks=tasks.filter(t=>t.status==="completed");
    const todayJobs=leads.filter(l=>l.scheduledDate===today||l.nextVisitDate===today||l.serviceDay===new Date().toLocaleDateString("en-US",{weekday:"long"}));
    const done=todayJobs.filter(l=>l.status==="completed");
    const running=sessions.filter(s=>s.status==="running");
    const overdue=leads.filter(l=>calculateVisitStatus(l)==="overdue");
    const pendingFeedback=getPendingReviewCount();
    const pendingPayments=leads.filter(l=>l.paymentStatus==="pending").reduce((s,l)=>s+l.total,0)+invoices.filter(i=>i.status==="sent"||i.status==="overdue"||i.status==="waiting_payment").reduce((s,i)=>s+i.total,0);
    const crewRows=DAMASIO_CREWS.map(crew=>{const jobs=leads.filter(l=>l.assignedCrew===crew);const completed=jobs.filter(l=>l.status==="completed").length;const active=running.filter(s=>s.crew===crew).length;return{crew,jobs,completed,active}}).filter(c=>c.jobs.length||c.crew===DAMASIO_CREWS[0]);
    const health=leads.map(l=>{const taskCount=tasks.filter(t=>t.leadId===l.id&&t.status!=="resolved").length;const visitStatus=calculateVisitStatus(l);let score=100;if(taskCount)score-=35;if(visitStatus==="overdue")score-=30;if(l.feedback&&l.feedback.rating<4)score-=25;if(l.paymentStatus==="pending")score-=10;return{lead:l,score,status:score>=75?"Healthy":score>=45?"Watch":"Risk"}}).sort((a,b)=>a.score-b.score).slice(0,6);
    return{todayJobs,done,running,overdue,openTasks,adminReviewTasks,pendingFeedback,pendingPayments,crewRows,health,expenses,notifications:getNotifications().filter(n=>!n.read),intelligence:getOperationsIntelligence()};
  },[leads,tick]);
  const selectedLead=selectedLog?leads.find(lead=>selectedLog.target===lead.id||selectedLog.target===lead.name||selectedLog.details.includes(lead.name)||selectedLog.details.includes(lead.address)):undefined;
  const selectedWorkflow=selectedLog?getWorkflowEvents().filter(event=>(selectedLead&&event.entityId===selectedLead.id)||event.entityId===selectedLog.target).sort((a,b)=>Math.abs(new Date(a.createdAt).getTime()-new Date(selectedLog.createdAt).getTime())-Math.abs(new Date(b.createdAt).getTime()-new Date(selectedLog.createdAt).getTime()))[0]:undefined;

  return <AdminShell active="Command">
    <div className="business-hero">
      <div><span className="eyebrow">Damasio OS V44</span><h1>Smart Operations Command Center</h1><p>One screen for today’s houses, live crews, overdue work, return visits, feedback and money.</p></div>
      <div className="hero-actions"><button className="btn btn-white" onClick={seed}>Load Demo</button><Link className="btn btn-primary" href="/admin/schedule">Create Route</Link></div>
    </div>

    <section className="business-metrics">
      <Link href="/admin/schedule" className="business-metric"><span>Today</span><strong>{data.todayJobs.length}</strong><small>{data.done.length} done · {data.running.length} running</small></Link>
      <Link href="/admin/alerts?status=overdue" className="business-metric warn"><span>Overdue</span><strong>{data.overdue.length}</strong><small>unfinished houses</small></Link>
      <Link href="/admin/tasks" className="business-metric warn"><span>Return Visits</span><strong>{data.openTasks.length}</strong><small>{data.adminReviewTasks.length} waiting admin</small></Link>
      <Link href="/admin/finance?filter=pending" className="business-metric"><span>Pending Payments</span><strong>{money(data.pendingPayments)}</strong><small>needs collection</small></Link>
    </section>

    <div className="ops-grid" style={{marginTop:20}}>
      <section className="card ops-panel">
        <div className="table-head"><div><h2>Live Dispatch</h2><p className="section-intro">Crew load, completion and active timers.</p></div><Link href="/admin/routes" className="btn btn-outline dark-safe">Open Routes</Link></div>
        {data.crewRows.map(c=>{const pct=c.jobs.length?Math.round(c.completed/c.jobs.length*100):0;return <Link key={c.crew} href={`/admin/routes?crew=${encodeURIComponent(c.crew)}`} className="crew-progress"><div><strong>{c.crew}</strong><p>{c.completed}/{c.jobs.length} done · {c.active} running</p></div><div><i style={{width:`${pct}%`}}></i></div></Link>})}
      </section>

      <section className="card ops-panel">
        <div className="table-head"><div><h2>Smart Alerts</h2><p className="section-intro">Important issues only.</p></div><Link href="/admin/alerts" className="btn btn-outline dark-safe">All Alerts</Link></div>
        <Link href="/admin/tasks" className="visit-row"><span className="dot overdue"></span><div><strong>{data.adminReviewTasks.length} completed tasks need admin review</strong><p>Resolve and move to history.</p></div><span className="pill">Open</span></Link>
        <Link href="/admin/customers" className="visit-row"><span className="dot upcoming"></span><div><strong>{data.pendingFeedback} customers pending feedback</strong><p>Track quality after visits.</p></div><span className="pill">View</span></Link>
        <Link href="/admin/finance?filter=pending" className="visit-row"><span className="dot booked"></span><div><strong>{money(data.pendingPayments)} pending</strong><p>Invoices and unpaid jobs.</p></div><span className="pill">Collect</span></Link>
      </section>
    </div>

    <section className="card table-card" style={{marginTop:20}}>
      <div className="table-head"><div><h2>Live Route</h2><p className="section-intro">Click any house to open the official Service Screen.</p></div><Link href="/admin/schedule" className="btn btn-primary">Dispatch</Link></div>
      <div className="table-wrap"><table><thead><tr><th>Status</th><th>Customer</th><th>Address</th><th>Crew</th><th>Next Cut</th><th>Open</th></tr></thead><tbody>{data.todayJobs.slice(0,10).map(l=>{const running=data.running.some(s=>s.leadId===l.id);const overdue=data.overdue.some(o=>o.id===l.id);const label=l.status==="completed"?"Done":running?"Running":overdue?"Overdue":"Open";return <tr key={l.id}><td><span className="pill">{label}</span></td><td><strong>{l.name}</strong><br/><small>{l.service}</small></td><td>{l.address}</td><td>{l.assignedCrew||"-"}</td><td>{l.nextVisitDate||l.scheduledDate||"-"}</td><td><Link className="btn btn-outline" href={serviceHref(l.id)}>Open</Link></td></tr>})}</tbody></table></div>
    </section>

    <div className="ops-grid" style={{marginTop:20}}>
      <section className="card ops-panel">
        <div className="table-head"><div><h2>Customer Health</h2><p className="section-intro">Risk based on return visits, overdue work, feedback and payment status.</p></div></div>
        {data.health.map(h=><Link key={h.lead.id} href={serviceHref(h.lead.id)} className="visit-row"><span className={h.status==="Risk"?"dot overdue":h.status==="Watch"?"dot upcoming":"dot booked"}></span><div><strong>{h.lead.name}</strong><p>{h.status} · score {h.score} · {h.lead.address}</p></div><span className="pill">Open</span></Link>)}
      </section>
      <section className="card ops-panel">
        <div className="table-head"><div><h2>Activity Timeline</h2><p className="section-intro">Recent operational changes.</p></div><Link href="/admin/logs" className="btn btn-outline dark-safe">Logs</Link></div>
        {getActivityLogs().slice(0,6).map(l=><button type="button" className="visit-row command-log-row" key={l.id} onClick={()=>setSelectedLog(l)}><span className="dot booked"></span><div><strong>{l.action}</strong><p>{new Date(l.createdAt).toLocaleString()} · {l.details}</p></div><span className="pill">Details</span></button>)}
      </section>
    </div>
    {selectedLog&&<div className="master-modal-backdrop" onMouseDown={()=>setSelectedLog(null)}><section className="master-modal" role="dialog" aria-modal="true" onMouseDown={event=>event.stopPropagation()}><header><h3>Change details</h3><button onClick={()=>setSelectedLog(null)}>×</button></header><div className="master-company-detail"><div className="master-detail-summary"><span className="active">{selectedLog.action}</span><strong>{selectedLog.actor}</strong><small>{new Date(selectedLog.createdAt).toLocaleString()}</small></div><section><h4>Affected record</h4><div className="master-person"><div><strong>{selectedLead?.name||selectedLog.target}</strong><small>{selectedLead?.address||"No property address linked"}</small></div></div></section><section><h4>Recorded change</h4><p className="master-muted">{selectedLog.details}</p></section>{selectedWorkflow&&<section><h4>Workflow transition</h4><div className="command-change-grid"><div><small>Before</small><strong>{selectedWorkflow.fromStage||"Not recorded"}</strong></div><b>→</b><div><small>After</small><strong>{selectedWorkflow.toStage}</strong></div></div><p className="master-muted">{selectedWorkflow.note}</p></section>}<div className="master-detail-actions">{selectedLead&&<Link className="secondary command-modal-link" href={`/admin/customers/${selectedLead.id}?tab=history`}>Open property history</Link>}<button onClick={()=>setSelectedLog(null)}>Close</button></div></div></section></div>}
  </AdminShell>
}
