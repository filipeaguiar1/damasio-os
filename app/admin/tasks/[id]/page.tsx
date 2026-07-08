"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {AdminShell} from "@/components/admin/AdminShell";
import {EmployeeTask,getEmployeeTasks,resolveEmployeeTask,seedDemoLeads,seedEmployeeTasks,unassignEmployeeTask} from "@/lib/storage";

function dateLabel(value?:string){return value?new Date(value+"T12:00:00").toLocaleDateString():"Not scheduled"}
function dateTime(value?:string){return value?new Date(value).toLocaleString():"Not recorded"}
function formatDuration(seconds?:number){if(!seconds)return "Not recorded";const m=Math.floor(seconds/60);const s=seconds%60;return m?`${m} min ${s}s`:`${s}s`}
function isAssigned(t:EmployeeTask){return t.status==="assigned"||t.status==="in_progress"||t.status==="completed"|| (!!t.assignedTo&&t.assignedTo!=="Admin"&&t.assignedTo!=="Unassigned")}

export default function TaskDetailPage(){
  const params=useParams<{id:string}>();
  const[task,setTask]=useState<EmployeeTask|null>(null);
  function refresh(){setTask(getEmployeeTasks().find(t=>t.id===params.id)||null)}
  useEffect(()=>{seedDemoLeads();seedEmployeeTasks();refresh()},[params.id]);
  return <AdminShell active="Tasks">
    <div className="calendar-heading"><div><span className="eyebrow">Task Details</span><h1>Return Visit Completion</h1><p className="section-intro">Review the customer issue, employee notes, timer, completion time, worker/crew, and photos saved for this task.</p></div><Link className="btn btn-outline" href={task?.status==="resolved"?"/admin/tasks/history":"/admin/tasks/open"}>Back</Link></div>
    {!task?<section className="card"><div className="empty-state"><strong>Task not found.</strong><p>It may have been removed from local demo data.</p></div></section>:<div className="grid-2">
      <section className="card profile-card task-preview-card"><span className={task.priority==="urgent"?"pill red":"pill"}>{task.priority}</span><h2>{task.title}</h2><div className="history-comment"><span>Customer issue</span><em>{task.description}</em></div><div className="info-list"><div><strong>Customer</strong><span>{task.customer}</span></div><div><strong>Property</strong><span>{task.address}</span></div><div><strong>Assigned to</strong><span>{isAssigned(task)?task.assignedTo:"Waiting for Admin"}</span></div><div><strong>Return day</strong><span>{dateLabel(task.scheduledDate)}</span></div><div><strong>Status</strong><span>{task.status}</span></div><div><strong>Started</strong><span>{dateTime(task.workStartedAt)}</span></div><div><strong>Finished</strong><span>{dateTime(task.workFinishedAt||task.resolvedAt)}</span></div><div><strong>Timer</strong><span>{formatDuration(task.durationSeconds)}</span></div>{task.completedBy&&<div><strong>Completed by</strong><span>{task.completedBy}</span></div>}</div><div className="row" style={{marginTop:18}}><Link className="btn btn-primary" href={`/admin/customers/${task.leadId}`}>View Property</Link>{isAssigned(task)&&task.status!=="resolved"&&<button className="btn btn-outline danger-soft" onClick={()=>{if(window.confirm("Remove this assignment?\n\nThe employee and scheduled date will be removed.\nThe task will return to Open.")){unassignEmployeeTask(task.id);refresh()}}}>Unassign</button>}<button className="btn btn-outline" disabled={task.status!=="completed"} onClick={()=>{if(task.status!=="completed")return; if(!window.confirm("Resolve this Return Visit?\n\nThis task will be moved to History.\nThis action cannot be undone."))return; const note=window.prompt("What was done at the property?", task.workDone || "Return visit completed and customer issue fixed."); if(note!==null){resolveEmployeeTask(task.id,note,"Admin");refresh()}}}>Resolve</button></div></section>
      <section className="card profile-card employee-preview"><span className="eyebrow">Completion record</span><h2>What was completed</h2><div className="history-comment done"><span>Work completed</span><em>{task.workDone || "No completion note was added yet."}</em></div><div className="task-meta-strip"><span>Started: <strong>{dateTime(task.workStartedAt)}</strong></span><span>Finished: <strong>{dateTime(task.workFinishedAt||task.resolvedAt)}</strong></span><span>Timer: <strong>{formatDuration(task.durationSeconds)}</strong></span></div><h3 style={{marginTop:18}}>Photos</h3>{task.completionPhotos?.length?<div className="photo-grid-small">{task.completionPhotos.map((p,i)=><img key={i} src={p} alt={`Completion photo ${i+1}`}/>)}</div>:<div className="empty-state"><strong>No photos attached.</strong><p>When the employee uploads service photos before completing the task, they will appear here for Admin and Customer history.</p></div>}<div className="row" style={{marginTop:18}}><Link className="btn btn-outline" href={`/admin/customers/${task.leadId}`}>View Property</Link></div></section>
    </div>}
  </AdminShell>
}
