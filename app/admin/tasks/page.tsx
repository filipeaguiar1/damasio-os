"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { DAMASIO_SYNC_EVENT, EmployeeTask, Lead, assignEmployeeTask, createAdminTask, getAssignableWorkers, getEmployeeTasks, getLeads, resolveEmployeeTask, seedDemoLeads, seedEmployeeTasks, unassignEmployeeTask } from "@/lib/storage";

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("Return Visit");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<EmployeeTask["priority"]>("normal");
  const [assignedTo, setAssignedTo] = useState("Filipe");
  const [scheduledDate, setScheduledDate] = useState("");
  const [message, setMessage] = useState("Tasks are shown from the operational task center, so Admin can always see them even before Supabase is fully configured.");
  const [filter,setFilter]=useState("all");
  const workers = useMemo(()=>getAssignableWorkers(),[tasks,leads]);

  function refresh() { setTasks(getEmployeeTasks()); setLeads(getLeads()); }
  useEffect(() => { refresh(); const on=()=>refresh(); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.removeEventListener("storage",on)} }, []);

  const filteredTasks = useMemo(()=>tasks.filter(task=>{
    if(filter==="open")return task.status!=="resolved";
    if(filter==="resolved")return task.status==="resolved";
    if(filter==="urgent")return task.priority==="urgent"&&task.status!=="resolved";
    if(filter==="admin")return task.assignedTo==="Admin"&&task.status!=="resolved";
    if(filter==="crew")return task.assignedTo!=="Admin"&&task.status!=="resolved";
    return true;
  }),[tasks,filter]);
  const open = useMemo(()=>filteredTasks.filter((task) => task.status !== "resolved"),[filteredTasks]);
  const history = useMemo(()=>tasks.filter((task) => task.status === "resolved"),[tasks]);
  const urgent = open.filter((task) => task.priority === "urgent").length;

  function loadDemo(){seedDemoLeads(true);seedEmployeeTasks();refresh();setMessage("Demo tasks loaded. You can assign, resolve or open the related employee route.")}
  function createTask(){
    const id=leadId||leads[0]?.id;
    if(!id){setMessage("Create or load a customer/property first.");return;}
    const task=createAdminTask({leadId:id,title,description:description||"Return visit required.",priority,assignedTo,scheduledDate:scheduledDate||undefined});
    if(task){setMessage(`Task created for ${task.customer} and assigned to ${task.assignedTo}.`);setDescription("");refresh();}
  }
  function assignTask(task:EmployeeTask,to:string,date?:string){
    const returnDate=date||scheduledDate||new Date().toISOString().slice(0,10);
    if(!window.confirm(`Assign this Return Visit?

Employee: ${to}
Return Date: ${returnDate}

After assigning, another employee cannot be selected until you click Unassign.`)) return;
    const ok=assignEmployeeTask(task.id,to,returnDate);
    setMessage(ok?`Task assigned to ${to} for ${returnDate}.`:"This task is already assigned. Use Unassign before selecting another employee.");refresh()
  }
  function unassignTask(task:EmployeeTask){
    if(!window.confirm(`Remove this assignment?

The employee and scheduled date will be removed.
The task will return to Open.`)) return;
    const ok=unassignEmployeeTask(task.id,"Admin unassigned the return visit.");
    setMessage(ok?"Task unassigned and returned to Open.":"Only Assigned tasks can be unassigned.");refresh()
  }
  function resolveTask(task:EmployeeTask){
    if(task.status!=="completed"){setMessage("Resolve is available only after Employee completes the task.");return;}
    if(!window.confirm(`Resolve this Return Visit?

This task will be moved to History.
This action cannot be undone.`)) return;
    resolveEmployeeTask(task.id,"Resolved from Admin task center.","Admin");setMessage("Task resolved and kept in history.");refresh()
  }

  return (
    <AdminShell active="Tasks">
      <div className="app-top"><div><span className="eyebrow">V42.8.2 Core Integration</span><h1>Tasks & Return Visits</h1><p className="section-intro">Admin can see every open task, assign it to an employee/crew, schedule it and keep resolved tasks in history.</p></div><div className="toolbar-inline"><span className="pill red">{open.length} open</span><CompactFilter><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All</label><label><input type="radio" checked={filter==="open"} onChange={()=>setFilter("open")}/> Open</label><label><input type="radio" checked={filter==="urgent"} onChange={()=>setFilter("urgent")}/> Urgent</label><label><input type="radio" checked={filter==="admin"} onChange={()=>setFilter("admin")}/> Admin queue</label><label><input type="radio" checked={filter==="crew"} onChange={()=>setFilter("crew")}/> Assigned crew</label><label><input type="radio" checked={filter==="resolved"} onChange={()=>setFilter("resolved")}/> Resolved</label></CompactFilter><button className="btn btn-outline" onClick={refresh}>Refresh</button><button className="btn btn-primary" onClick={loadDemo}>Load Demo</button></div></div>

      <section className="quick-actions crew-cards">
        <Link className="quick-action" href="/admin/tasks"><span>{open.length}</span><strong>Open Tasks</strong><small>{urgent} urgent</small></Link>
        <Link className="quick-action" href="/admin/tasks/history"><span>{history.length}</span><strong>Task History</strong><small>Resolved returns</small></Link>
        <Link className="quick-action" href="/admin/schedule"><span>→</span><strong>Schedule Route</strong><small>Assign date/crew</small></Link>
      </section>

      <section className="card profile-card" style={{ marginBottom: 20 }}>
        <div className="table-head"><div><h2>Create Task / Return Visit</h2><p className="section-intro">Use this when the customer complained, something was missed, or Admin wants an employee to return.</p></div></div>
        <div className="form-grid">
          <div className="field"><label>Property</label><select className="input" value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">Select property</option>{leads.map(l=><option value={l.id} key={l.id}>{l.name} — {l.address}</option>)}</select></div>
          <div className="field"><label>Assign to</label><select className="input" value={assignedTo} onChange={e=>setAssignedTo(e.target.value)}>{workers.map(c=><option key={c}>{c}</option>)}</select></div>
          <div className="field"><label>Priority</label><select className="input" value={priority} onChange={e=>setPriority(e.target.value as EmployeeTask["priority"])}><option value="low">low</option><option value="normal">normal</option><option value="urgent">urgent</option></select></div>
          <div className="field"><label>Scheduled Date</label><input className="input" type="date" value={scheduledDate} onChange={e=>setScheduledDate(e.target.value)}/></div>
        </div>
        <div className="form-grid" style={{marginTop:12}}>
          <div className="field"><label>Title</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)}/></div>
          <div className="field"><label>Description</label><input className="input" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Example: edge was missed near backyard fence"/></div>
        </div>
        <div className="row" style={{marginTop:16}}><button className="btn btn-primary" onClick={createTask}>Create Task</button>{leads.length===0&&<button className="btn btn-outline" onClick={loadDemo}>Load Demo Customers</button>}</div>
        {message&&<div className="payment-message" style={{marginTop:14}}>{message}</div>}
      </section>

      <section className="card table-card"><div className="table-head"><div><h2>Open Tasks</h2><p className="section-intro">Choose worker, return date and keep the reason visible to Admin and Employee.</p></div><span className="sync-note">Filter: {filter}</span></div><div className="table-wrap"><table><thead><tr><th>Task / Reason</th><th>Customer</th><th>Priority</th><th>Assign</th><th>Status</th><th>Actions</th></tr></thead><tbody>{open.length === 0 ? <tr><td colSpan={6}>No open tasks. Create one above or load demo tasks.</td></tr> : open.map((task) => <tr key={task.id}><td><strong>{task.title}</strong><br/><small>{task.description}</small></td><td>{task.customer}<br/><small>{task.address}</small></td><td>{task.priority}</td><td><div className="field mini-field"><select className="input" defaultValue={task.assignedTo} id={`worker-${task.id}`}>{workers.map(w=><option key={w}>{w}</option>)}</select><input className="input" type="date" defaultValue={task.scheduledDate||scheduledDate} id={`date-${task.id}`}/></div></td><td><span className="pill">{task.status}</span>{task.assignedTo&&task.assignedTo!=="Admin"&&<><br/><small>Assigned to {task.assignedTo}</small></>}</td><td><div className="row"><button className="btn btn-outline" disabled={task.status!=="open" || (task.assignedTo!=="Admin"&&task.assignedTo!=="Unassigned")} onClick={() => {const w=(document.getElementById(`worker-${task.id}`) as HTMLSelectElement)?.value||task.assignedTo; const d=(document.getElementById(`date-${task.id}`) as HTMLInputElement)?.value||scheduledDate||new Date().toISOString().slice(0,10); assignTask(task,w,d)}}>Assign</button><Link className="btn btn-outline" href={`/admin/customers/${task.leadId}`}>Open</Link>{task.status==="assigned"&&<button className="btn btn-outline" onClick={() => unassignTask(task)}>Unassign</button>}<button className="btn btn-outline" disabled={task.status!=="completed"} onClick={() => resolveTask(task)}>Resolve</button></div></td></tr>)}</tbody></table></div></section>
      <section className="card table-card" style={{ marginTop: 20 }}><div className="table-head"><div><h2>Resolved History</h2></div></div><div className="table-wrap"><table><thead><tr><th>Task</th><th>Customer</th><th>Resolved</th><th>Summary</th></tr></thead><tbody>{history.length === 0 ? <tr><td colSpan={4}>No resolved tasks yet.</td></tr> : history.slice(0, 20).map((task) => <tr key={task.id}><td><strong>{task.title}</strong></td><td>{task.customer}<br/><small>{task.address}</small></td><td>{task.resolvedAt ? new Date(task.resolvedAt).toLocaleString() : "Resolved"}</td><td>{task.completionSummary || task.workDone || "Resolved"}</td></tr>)}</tbody></table></div></section>
    </AdminShell>
  );
}
