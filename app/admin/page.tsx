"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {DAMASIO_CREWS,DAMASIO_SYNC_EVENT,Lead,calculateVisitStatus,getActivityLogs,getEmployeeTasks,getExpenses,getEstimates,getInvoices,getLeads,getNotifications,getOperationsIntelligence,seedDemoEstimates,seedDemoExpenses,seedDemoLeads,getServiceRequests,seedDemoRequests} from "@/lib/storage";

function todayKey(){return new Date().toISOString().slice(0,10)}
function money(n:number){return `$${n.toLocaleString(undefined,{maximumFractionDigits:0})}`}

export default function Admin(){
  const[leads,setLeads]=useState<Lead[]>([]);const[stamp,setStamp]=useState("");
  function refresh(){setLeads(getLeads());const sync=typeof window!=="undefined"?window.localStorage.getItem("damasio_os_last_sync"):"";setStamp(sync?JSON.parse(sync).at:"")}
  useEffect(()=>{seedDemoLeads();seedDemoEstimates();seedDemoExpenses();seedDemoRequests();refresh();const onSync=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,onSync as EventListener);window.addEventListener("storage",onSync);const t=setInterval(refresh,2500);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,onSync as EventListener);window.removeEventListener("storage",onSync);clearInterval(t)}},[]);
  const data=useMemo(()=>{const requests=getServiceRequests();const invoices=getInvoices();const estimates=getEstimates();const expenses=getExpenses();const revenue=leads.filter(l=>l.paymentStatus==="paid"||l.status==="completed").reduce((s,l)=>s+l.total,0);const pending=leads.filter(l=>l.paymentStatus==="pending").reduce((s,l)=>s+l.total,0)+invoices.filter(i=>i.status==="sent"||i.status==="overdue").reduce((s,i)=>s+i.total,0);const expenseTotal=expenses.reduce((s,e)=>s+e.amount,0);const active=leads.filter(l=>l.status!=="lost");const assigned=leads.filter(l=>l.assignedCrew);const today=todayKey();return{requests,waitingAssignment:requests.filter(r=>r.status==="accepted"&&!r.jobId),invoices,estimates,expenses,revenue,pending,expenseTotal,profit:revenue-expenseTotal,active,assigned,todayJobs:assigned.filter(l=>l.nextVisitDate===today||l.scheduledDate===today),overdue:leads.filter(l=>calculateVisitStatus(l)==="overdue"),upcoming:leads.filter(l=>calculateVisitStatus(l)==="upcoming"),issues:getEmployeeTasks().filter(t=>t.status!=="resolved"),notifications:getNotifications().filter(n=>!n.read),intelligence:getOperationsIntelligence()}} ,[leads]);

  return <AdminShell active="Dashboard">
    <div className="business-hero">
      <div><span className="eyebrow">V49 Production Readiness</span><h1>ERP dashboard connected to operations, finance, SaaS, AI, mobile and production readiness.</h1><p>Use Command for live operations, Dispatch for routes, Production for readiness and Service Screen for every property.</p></div>
      <div className="hero-actions"><Link className="btn btn-primary" href="/admin/command">Open Command Center</Link><Link className="btn btn-white" href="/admin/schedule">Create Route</Link></div>
    </div>

    <section className="business-metrics">
      <Link href="/admin/finance" className="business-metric"><span>Revenue</span><strong>{money(data.revenue)}</strong><small>paid/completed work</small></Link>
      <Link href="/admin/finance?filter=pending" className="business-metric warn"><span>Pending</span><strong>{money(data.pending)}</strong><small>needs collection</small></Link>
      <Link href="/admin/finance" className="business-metric"><span>Profit Est.</span><strong>{money(data.profit)}</strong><small>revenue minus expenses</small></Link>
      <Link href="/admin/requests?filter=accepted" className="business-metric warn"><span>Jobs Waiting Assignment</span><strong>{data.waitingAssignment.length}</strong><small>approved requests</small></Link>
    </section>

    <section className="business-metrics" style={{marginTop:20}}>
      <Link href="/admin/schedule" className="business-metric"><span>Dispatch</span><strong>{data.todayJobs.length}</strong><small>jobs scheduled today</small></Link>
      <Link href="/admin/routes" className="business-metric"><span>Completed Visits</span><strong>{data.intelligence.completedJobs}</strong><small>unified visit history</small></Link>
      <Link href="/admin/tasks" className="business-metric warn"><span>Open Tasks</span><strong>{data.intelligence.openTasks}</strong><small>return visits/issues</small></Link>
      <Link href="/admin/operations" className="business-metric"><span>Workflow Engine</span><strong>{Object.keys(data.intelligence.workflowStages).length}</strong><small>active lifecycle stages</small></Link>
      <Link href="/admin/production" className="business-metric"><span>Production</span><strong>V49</strong><small>readiness checklist</small></Link>
    </section>

    <section className="card table-card" style={{marginTop:20}}>
      <div className="table-head"><div><h2>V41 Database Foundation</h2><p className="section-intro">Backend schema is prepared. Open this setup screen to connect Supabase and test the real database.</p></div><Link href="/admin/database" className="btn btn-primary">Open Database Setup</Link><Link href="/admin/users" className="btn btn-white">Manage Users</Link></div>
    </section>

    <section className="suite-grid">
      <Link href="/admin/leads" className="suite-card crm"><b>01</b><h2>CRM Pipeline</h2><p>Track leads from new request to customer with a simple board.</p><span>Open Leads →</span></Link>
      <Link href="/admin/estimates" className="suite-card estimate"><b>02</b><h2>Estimate Center</h2><p>Quote lot size, grass height, mulch, bags and services.</p><span>Create Quote →</span></Link>
      <Link href="/admin/finance" className="suite-card finance"><b>03</b><h2>Finance Center</h2><p>Invoices, payments, pending balances, expenses and profit.</p><span>Open Finance →</span></Link>
      <Link href="/admin/schedule" className="suite-card route"><b>04</b><h2>Dispatch</h2><p>Create routes, choose date, assign crew and send houses to employees.</p><span>Create Route →</span></Link>
      <Link href="/admin/production" className="suite-card"><b>05</b><h2>Production Readiness</h2><p>Check blockers before selling, onboarding companies or going live.</p><span>Open Checklist →</span></Link>
    </section>

    <div className="ops-grid">
      <section className="card ops-panel">
        <div className="table-head"><div><h2>Today’s Crews</h2><p className="section-intro">Live assignment summary. Employees see only their own homes.</p></div><span className="pill">Sync {stamp?new Date(stamp).toLocaleTimeString():"ready"}</span></div>
        {DAMASIO_CREWS.slice(0,4).map(c=>{const jobs=data.assigned.filter(l=>l.assignedCrew===c);const done=jobs.filter(j=>j.status==="completed").length;return <Link href="/admin/routes" className="crew-progress" key={c}><div><strong>{c}</strong><p>{done}/{jobs.length} completed</p></div><div><i style={{width:`${jobs.length?Math.round(done/jobs.length*100):0}%`}}></i></div></Link>})}
      </section>
      <section className="card ops-panel">
        <div className="table-head"><div><h2>Business Alerts</h2><p className="section-intro">Cards open the exact area to fix each issue.</p></div></div>
        <Link href="/admin/alerts?status=overdue" className="visit-row"><span className="dot overdue"></span><div><strong>{data.overdue.length} overdue visits</strong><p>Resolve late houses</p></div><span className="pill">Open</span></Link>
        <Link href="/admin/alerts?status=upcoming" className="visit-row"><span className="dot upcoming"></span><div><strong>{data.upcoming.length} need booking soon</strong><p>Book before service day</p></div><span className="pill">Open</span></Link>
        <Link href="/admin/finance?filter=pending" className="visit-row"><span className="dot booked"></span><div><strong>{money(data.pending)} pending payments</strong><p>Collect or mark paid</p></div><span className="pill">Open</span></Link>
      </section>
    </div>

    <section className="card table-card" style={{marginTop:20}}>
      <div className="table-head"><div><h2>Recent Changes</h2><p className="section-intro">Assignment, AI route and finance actions are tracked.</p></div><Link href="/admin/logs" className="btn btn-outline dark-safe">View Logs</Link></div>
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>{getActivityLogs().slice(0,7).map(l=><tr key={l.id}><td>{new Date(l.createdAt).toLocaleTimeString()}</td><td>{l.actor}</td><td>{l.action}</td><td>{l.target}</td><td>{l.details}</td></tr>)}</tbody></table></div>
    </section>
  </AdminShell>
}
