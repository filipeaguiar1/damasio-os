"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {DAMASIO_CREWS,EmployeeTask,assignEmployeeTask,getEmployeeTasks,resolveEmployeeTask,seedDemoLeads,seedEmployeeTasks,unassignEmployeeTask} from "@/lib/storage";

const WORKERS=["Filipe","Employee A","Employee B","Employee C",...DAMASIO_CREWS];
function today(){return new Date().toISOString().slice(0,10)}
function isAssigned(t:EmployeeTask){return t.status==="assigned"||t.status==="in_progress"||t.status==="completed"|| (!!t.assignedTo&&t.assignedTo!=="Admin"&&t.assignedTo!=="Unassigned")}
function dateLabel(value?:string){return value?new Date(value+"T12:00:00").toLocaleDateString():"No date"}

export default function OpenTasksPage(){
  const[tasks,setTasks]=useState<EmployeeTask[]>([]);
  const[expanded,setExpanded]=useState<string|null>(null);
  const[worker,setWorker]=useState("");
  const[date,setDate]=useState(today());
  const[message,setMessage]=useState("");
  function refresh(){setTasks(getEmployeeTasks())}
  useEffect(()=>{seedDemoLeads();seedEmployeeTasks();refresh()},[]);
  const open=tasks.filter(t=>t.status!=="resolved");
  const waiting=open.filter(t=>!isAssigned(t));
  const assigned=open.filter(isAssigned);
  function startAssign(id:string){setExpanded(expanded===id?null:id);setWorker("");setDate(today());setMessage("")}
  function assign(id:string){
    if(!worker){setMessage("Selecione um worker ou crew antes de enviar a task.");return}
    if(!window.confirm(`Assign this Return Visit?

Employee: ${worker}
Return Date: ${date}

After assigning, another employee cannot be selected until you click Unassign.`))return;
    const ok=assignEmployeeTask(id,worker,date);setExpanded(null);setMessage(ok?"Task assigned and locked to the selected worker/crew.":"This task is already assigned. Use Unassign before selecting another worker.");refresh();
  }
  function removeFromEmployee(t:EmployeeTask){
    if(window.confirm(`Remove this assignment?\n\nThe employee and scheduled date will be removed.\nThe task will return to Open.`)){
      const ok=unassignEmployeeTask(t.id,"Admin removed the task from the assigned employee/crew.");
      setMessage(ok?"Task unassigned and returned to Open.":"Only Assigned tasks can be unassigned.");refresh();
    }
  }
  function renderTask(t:EmployeeTask,mode:"waiting"|"assigned"){
    return <div className="task-row-pro" key={t.id}>
      <div className="task-status-column">
        <button className="round-plus" disabled={mode==="assigned"} onClick={()=>startAssign(t.id)} aria-label="Assign task">{expanded===t.id?"−":"+"}</button>
        <span className={t.priority==="urgent"?"pill red":"pill"}>{t.priority}</span>
      </div>
      <div className="task-main-clean">
        <div className="task-title-line"><strong>{t.title}</strong><span className="pill">{t.status}</span>{isAssigned(t)&&<span className="pill green">{t.assignedTo}</span>}</div>
        <p>{t.customer} · {t.address}</p>
        <small>{t.description}</small>
        {isAssigned(t)&&<div className="task-meta-strip"><span>Return day: <strong>{dateLabel(t.scheduledDate)}</strong></span><span>Employee view: <strong>{t.status==="in_progress"?"Started":"Pending"}</strong></span></div>}
        {expanded===t.id&&<div className="assign-panel-clean"><label>Worker / Crew<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="">Select worker or crew</option>{WORKERS.map(w=><option key={w}>{w}</option>)}</select></label><label>Return day<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="btn btn-primary" onClick={()=>assign(t.id)}>Send to Employee</button></div>}
      </div>
      <div className="task-actions-clean">
        <Link className="btn btn-outline" href={`/admin/tasks/${t.id}`}>View</Link>
        <Link className="btn btn-outline" href={`/admin/customers/${t.leadId}`}>Open Property</Link>
        {mode==="assigned"&&<button className="btn btn-outline danger-soft" onClick={()=>removeFromEmployee(t)}>Unassign</button>}
        <button className="btn btn-outline" onClick={()=>{if(t.status!=="completed"){setMessage("Resolve is available only after Employee completes the task.");return} if(window.confirm("Resolve this Return Visit?\n\nThis task will be moved to History.\nThis action cannot be undone.")){resolveEmployeeTask(t.id);refresh()}}}>Resolve</button>
      </div>
    </div>
  }
  return <AdminShell active="Tasks">
    <div className="calendar-heading"><div><span className="eyebrow">Open Tasks</span><h1>Assign Return Visits</h1><p className="section-intro">A task stays with Admin until you choose the worker/crew and return day. Assigned tasks stay pending for the Employee until they complete it.</p></div><Link className="btn btn-outline" href="/admin/tasks">Back</Link></div>
    {message&&<div className="payment-message" style={{marginBottom:16}}>{message}</div>}
    <section className="card table-card task-center-card">
      <div className="table-head"><div><h2>{waiting.length} waiting · {assigned.length} assigned</h2><p>Use + to assign. After assigned, the worker is locked. Use Unassign to return it to Open before selecting another worker.</p></div><Link className="btn btn-primary" href="/admin/tasks/history">Task History</Link></div>
      <h3 className="task-section-title">Waiting for Admin</h3>
      {waiting.length===0?<div className="empty-state"><strong>No unassigned tasks.</strong><p>Everything has been sent or resolved.</p></div>:waiting.map(t=>renderTask(t,"waiting"))}
      <h3 className="task-section-title">Sent to Employee / Crew</h3>
      {assigned.length===0?<div className="empty-state"><strong>No tasks currently sent.</strong><p>Assigned tasks will appear here until completed or returned to Admin.</p></div>:assigned.map(t=>renderTask(t,"assigned"))}
    </section>
  </AdminShell>
}
