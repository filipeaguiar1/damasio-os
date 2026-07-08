"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DAMASIO_SYNC_EVENT,
  Lead,
  finishServiceSession,
  formatDuration,
  getEmployeeProfile,
  getEmployeeTasks,
  getLeads,
  getSessionForLead,
  saveServiceComment,
  saveServicePhotos,
  seedDemoLeads,
  startServiceSession,
  updateEmployeeTaskStatus
} from "@/lib/storage";

function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}
function statusLabel(lead:Lead){return lead.status==="completed"?"Done":"Open"}

export default function MobileEmployeeApp(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [tab,setTab]=useState<"route"|"service"|"issues">("route");
  const [comment,setComment]=useState("");
  const [tick,setTick]=useState(0);
  const [message,setMessage]=useState("");
  const photoInput=useRef<HTMLInputElement|null>(null);
  const profile=getEmployeeProfile();

  function refresh(){
    seedDemoLeads();
    const rows=getLeads();
    setLeads(rows);
    if(!selectedId && rows[0]) setSelectedId(rows[0].id);
  }

  useMobileRealtime(refresh);
  useEffect(()=>{refresh(); const on=()=>refresh(); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); const t=window.setInterval(()=>setTick(v=>v+1),1000); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);window.clearInterval(t)}},[]);

  const route=useMemo(()=>leads.filter(l=>l.assignedCrew==="Crew A" || !l.assignedCrew).sort((a,b)=>(a.serviceDay||"").localeCompare(b.serviceDay||"")||a.address.localeCompare(b.address)),[leads]);
  const selected=useMemo(()=>leads.find(l=>l.id===selectedId)||route[0]||null,[leads,route,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const seconds=useMemo(()=>{
    if(!session)return 0;
    if(session.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return session.durationSeconds||0;
  },[session,tick]);
  const tasks=getEmployeeTasks().filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo==="Crew A"));
  const done=route.filter(l=>l.status==="completed").length;

  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setTab("service"); setMessage("")}
  function start(){if(!selected)return; startServiceSession(selected.id,profile.name,"Crew A"); refresh(); setMessage("Service started.")}
  function finish(){if(!selected)return; if(!window.confirm("Finish this service and mark this house as Done?"))return; finishServiceSession(selected.id,comment); refresh(); setMessage("Done. Service sent to history.")}
  function saveNote(){if(!selected||!comment.trim())return; saveServiceComment(selected.id,comment); refresh(); setMessage("Comment saved.")}
  function upload(e:ChangeEvent<HTMLInputElement>){
    if(!selected)return;
    const files=Array.from(e.target.files||[]).slice(0,5);
    Promise.all(files.map(f=>new Promise<string>(resolve=>{const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||"")); reader.readAsDataURL(f)}))).then(images=>{saveServicePhotos(selected.id,[...(selected.photos||[]),...images].slice(0,5)); refresh(); setMessage("Photo saved.")});
    e.target.value="";
  }

  return <main className="mobile-app-shell">
    <header className="mobile-topbar">
      <Link href="/mobile" className="mobile-back">‹</Link>
      <div><strong>Employee App</strong><span>{profile.name || "Field user"}</span></div>
      <div className="mobile-avatar">{(profile.photoLabel||profile.name||"E").slice(0,1)}</div>
    </header>

    <section className="mobile-stats-card">
      <div><span>Today</span><strong>{route.length}</strong><small>homes</small></div>
      <div><span>Done</span><strong>{done}</strong><small>completed</small></div>
      <div><span>Issues</span><strong>{tasks.length}</strong><small>return</small></div>
    </section>

    <nav className="mobile-tabs">
      <button className={tab==="route"?"active":""} onClick={()=>setTab("route")}>Route</button>
      <button className={tab==="service"?"active":""} onClick={()=>setTab("service")}>Service</button>
      <button className={tab==="issues"?"active":""} onClick={()=>setTab("issues")}>Issues</button>
    </nav>

    {tab==="route"&&<section className="mobile-card-list">
      {route.map((lead,index)=><button className="mobile-route-card" key={lead.id} onClick={()=>openService(lead)}>
        <span className="mobile-route-index">{index+1}</span>
        <div><strong>{lead.name}</strong><p>{lead.address}</p><em>{lead.serviceFrequency||"weekly"} · Next: {lead.nextVisitDate||lead.scheduledDate||"—"}</em></div>
        <b className={lead.status==="completed"?"mobile-status done":"mobile-status"}>{statusLabel(lead)}</b>
      </button>)}
    </section>}

    {tab==="service"&&selected&&<section className="mobile-service-screen">
      <div className="mobile-property-photo">{selected.propertyPhoto?<img src={selected.propertyPhoto} alt="Property"/>:<span>Property photo</span>}</div>
      <div className="mobile-service-head">
        <div><h1>{selected.name}</h1><p>{selected.address}</p></div>
        <b className={selected.status==="completed"?"mobile-status done":"mobile-status"}>{statusLabel(selected)}</b>
      </div>
      <div className="mobile-service-info"><span>Service</span><strong>{selected.service}</strong></div>
      <div className="mobile-timer-card"><span>Timer</span><strong>{formatDuration(seconds)}</strong><small>{session?.status||"not started"}</small></div>
      <div className="mobile-action-grid">
        <button className="mobile-primary" disabled={session?.status==="running"||selected.status==="completed"} onClick={start}>Start</button>
        <button className="mobile-finish" disabled={session?.status!=="running"} onClick={finish}>Finish</button>
      </div>
      <a className="mobile-outline" href={mapsHref(selected.address)} target="_blank">Open Google Maps</a>
      <textarea className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Optional comment for this visit" />
      <button className="mobile-outline" onClick={saveNote}>Save Comment</button>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={upload}/>
      <button className="mobile-outline" onClick={()=>photoInput.current?.click()}>Take / Upload Photo</button>
      {message&&<p className="mobile-message">{message}</p>}
    </section>}

    {tab==="issues"&&<section className="mobile-card-list">
      {tasks.length===0?<div className="mobile-empty"><strong>No return visits.</strong><p>Assigned issues will appear here.</p></div>:tasks.map(task=><article className="mobile-issue-card" key={task.id}>
        <strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>{task.description}</small>
        <div className="mobile-action-grid"><button className="mobile-primary" onClick={()=>{updateEmployeeTaskStatus(task.id,"in_progress"); setMessage("Task started."); refresh()}}>Start</button><button className="mobile-finish" onClick={()=>{if(window.confirm("Mark this return visit as completed? It will leave your account and go to Admin review.")){updateEmployeeTaskStatus(task.id,"completed","Completed from mobile app",profile.name); refresh()}}}>Complete</button></div>
      </article>)}
    </section>}
  </main>
}
