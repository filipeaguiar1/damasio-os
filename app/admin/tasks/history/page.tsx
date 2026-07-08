"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {EmployeeTask,getEmployeeTasks,seedDemoLeads,seedEmployeeTasks} from "@/lib/storage";

function formatDuration(seconds?:number){if(!seconds)return "Not recorded";const m=Math.floor(seconds/60);const s=seconds%60;return m?`${m} min ${s}s`:`${s}s`}
function dateTime(value?:string){return value?new Date(value).toLocaleString():"Not recorded"}

export default function TaskHistoryPage(){
  const[tasks,setTasks]=useState<EmployeeTask[]>([]);
  useEffect(()=>{seedDemoLeads();seedEmployeeTasks();setTasks(getEmployeeTasks())},[]);
  const history=tasks.filter(t=>t.status==="resolved").sort((a,b)=>(b.resolvedAt||b.createdAt).localeCompare(a.resolvedAt||a.createdAt));
  return <AdminShell active="Tasks">
    <div className="calendar-heading"><div><span className="eyebrow">Task History</span><h1>Resolved Customer Tasks</h1><p className="section-intro">Compact list made for high volume. Admin and Customer can open the property and review exactly what was completed.</p></div><div className="row"><Link className="btn btn-outline" href="/admin/tasks">Back</Link><Link className="btn btn-primary" href="/admin/tasks/open">Open Tasks</Link></div></div>
    <section className="card task-history-card"><div className="table-head"><div><h2>{history.length} resolved task(s)</h2><p>Newest resolved tasks first.</p></div></div>
      <div className="task-history-compact">{history.length===0?<div className="empty-state"><strong>No resolved tasks yet.</strong><p>When a return visit is completed, it will appear here.</p></div>:history.map(t=><div className="task-history-row" key={t.id}>
        <div className="task-history-main"><strong>{t.title}</strong><p>{t.customer} · {t.address}</p><div className="history-comment"><span>Customer issue</span><em>{t.description}</em></div><div className="history-comment done"><span>Work completed</span><em>{t.workDone || "Employee marked the return visit as completed. Detailed completion notes were not added in this demo record."}</em></div></div>
        <div className="task-history-meta"><span className="pill green">Resolved</span><small>{dateTime(t.resolvedAt)}</small><small>{t.completedBy||t.assignedTo||"Employee"}</small><small>Timer: {formatDuration(t.durationSeconds)}</small><small>Photos: {t.completionPhotos?.length||0}</small></div>
        <div className="task-history-actions"><Link className="btn btn-primary" href={`/admin/tasks/${t.id}`}>View Work Details</Link><Link className="btn btn-outline" href={`/admin/customers/${t.leadId}`}>View Property</Link></div>
      </div>)}</div>
    </section>
  </AdminShell>
}
