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
  getLeadWorkflowSnapshot,
  getSessionForLead,
  saveServiceComment,
  saveServicePhotos,
  resetServiceSession,
  skipServiceSession,
  seedDemoLeads,
  startServiceSession,
  updateEmployeeTaskStatus
} from "@/lib/storage";

function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}
function statusLabel(lead:Lead, session?:ReturnType<typeof getSessionForLead>){return lead.status==="completed"?"Done":session?.status==="skipped"?"Skipped":"Open"}

export default function MobileEmployeeApp(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [tab,setTab]=useState<"route"|"service"|"issues">("route");
  const [comment,setComment]=useState("");
  const [tick,setTick]=useState(0);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [skipOpen,setSkipOpen]=useState(false);
  const [skipComment,setSkipComment]=useState("");
  const [skipPhotos,setSkipPhotos]=useState<string[]>([]);
  const skipPhotoInput=useRef<HTMLInputElement|null>(null);
  const photoInput=useRef<HTMLInputElement|null>(null);
  const profile=getEmployeeProfile();

  function refresh(){
    try{
      seedDemoLeads();
      const rows=getLeads();
      setLeads(rows);
      setError("");
      setSelectedId(current=>current&&rows.some(row=>row.id===current)?current:(rows[0]?.id||""));
    }catch{
      setError("Route data is temporarily unavailable.");
      setLeads([]);
    }
  }

  useMobileRealtime(refresh);
  useEffect(()=>{refresh(); const on=()=>refresh(); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); const t=window.setInterval(()=>setTick(v=>v+1),1000); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);window.clearInterval(t)}},[]);

  const route=useMemo(()=>leads.filter(l=>l.assignedCrew==="Crew A").sort((a,b)=>(a.serviceDay||"").localeCompare(b.serviceDay||"")||a.address.localeCompare(b.address)),[leads]);
  const selected=useMemo(()=>leads.find(l=>l.id===selectedId)||route[0]||null,[leads,route,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
  const details=selected?.propertyDetails;
  const seconds=useMemo(()=>{
    if(!session)return 0;
    if(session.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return session.durationSeconds||0;
  },[session,tick]);
  const tasks=useMemo(()=>{
    try{return getEmployeeTasks().filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo==="Crew A"))}
    catch{return []}
  },[leads,profile.name,tick]);
  const done=route.filter(l=>l.status==="completed").length;
  const skipped=route.filter(l=>getSessionForLead(l.id)?.status==="skipped").length;

  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setTab("service"); setMessage("")}
  function start(){
    if(!selected||busy)return;
    setBusy(true); setError("");
    try{startServiceSession(selected.id,profile.name,"Crew A"); refresh(); setMessage("Service started.")}
    catch{setError("Service could not be started. Please try again.")}
    finally{setBusy(false)}
  }
  function finish(){
    if(!selected||busy)return;
    if(!window.confirm("Finish this service and mark this house as Done?"))return;
    setBusy(true); setError("");
    try{finishServiceSession(selected.id,comment); refresh(); setMessage("Done. Service sent to history.")}
    catch{setError("Service could not be completed. Please try again.")}
    finally{setBusy(false)}
  }
  function reset(){
    if(!selected||busy)return;
    if(!window.confirm("Reset this house? The timer will be cleared and the visit will return to Open."))return;
    setBusy(true); setError("");
    try{resetServiceSession(selected.id); setComment(""); refresh(); setMessage("House reset to Open.")}
    catch{setError("House could not be reset.")}
    finally{setBusy(false)}
  }
  function openSkip(){
    if(!selected||busy)return;
    setSkipComment(""); setSkipPhotos([]); setSkipOpen(true); setError("");
  }
  function uploadSkipPhoto(e:ChangeEvent<HTMLInputElement>){
    const files=Array.from(e.target.files||[]).slice(0,5-skipPhotos.length);
    Promise.all(files.map(f=>new Promise<string>((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||"")); reader.onerror=()=>reject(new Error("read failed")); reader.readAsDataURL(f)}))).then(images=>setSkipPhotos(current=>[...current,...images].slice(0,5))).catch(()=>setError("Skip photo could not be added."));
    e.target.value="";
  }
  function confirmSkip(){
    if(!selected||busy)return;
    setBusy(true); setError("");
    try{skipServiceSession(selected.id,skipComment,skipPhotos,profile.name,"Crew A"); setSkipOpen(false); refresh(); setMessage("House skipped. Admin and Dispatch were notified."); setTab("route")}
    catch{setError("House could not be skipped.")}
    finally{setBusy(false)}
  }
  function saveNote(){
    if(!selected||!comment.trim()||busy)return;
    setBusy(true); setError("");
    try{saveServiceComment(selected.id,comment); refresh(); setMessage("Comment saved.")}
    catch{setError("Comment could not be saved.")}
    finally{setBusy(false)}
  }
  function upload(e:ChangeEvent<HTMLInputElement>){
    if(!selected)return;
    const files=Array.from(e.target.files||[]).slice(0,5);
    setBusy(true); setError("");
    Promise.all(files.map(f=>new Promise<string>((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||"")); reader.onerror=()=>reject(new Error("read failed")); reader.readAsDataURL(f)}))).then(images=>{saveServicePhotos(selected.id,[...(selected.photos||[]),...images].slice(0,5)); refresh(); setMessage("Photo saved.")}).catch(()=>setError("Photo could not be saved.")).finally(()=>setBusy(false));
    e.target.value="";
  }

  return <main className="mobile-app-shell">
    <header className="mobile-topbar">
      <Link href="/mobile" className="mobile-back">‹</Link>
      <div><strong>Employee App</strong><span>{profile.name || "Field user"}</span></div>
      <div className="mobile-avatar">{(profile.photoLabel||profile.name||"E").slice(0,1)}</div>
    </header>

    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}

    <section className="mobile-stats-card">
      <div><span>Today</span><strong>{route.length}</strong><small>homes</small></div>
      <div><span>Done</span><strong>{done}</strong><small>completed</small></div>
      <div><span>Skipped</span><strong>{skipped}</strong><small>review</small></div>
      <div><span>Issues</span><strong>{tasks.length}</strong><small>return</small></div>
    </section>

    <nav className="mobile-tabs mobile-tabs-two">
      <button className={tab==="route"?"active":""} onClick={()=>setTab("route")}>Route</button>
      <button className={tab==="issues"?"active":""} onClick={()=>setTab("issues")}>Issues</button>
    </nav>

    {tab==="route"&&<section className="mobile-card-list">
      {route.map((lead,index)=><button className="mobile-route-card" key={lead.id} onClick={()=>openService(lead)}>
        <span className="mobile-route-index">{index+1}</span>
        <div><strong>{lead.name}</strong><p>{lead.address}</p><em>{lead.serviceFrequency||"weekly"} · Next: {lead.nextVisitDate||lead.scheduledDate||"—"}</em></div>
        <b className={lead.status==="completed"?"mobile-status done":getSessionForLead(lead.id)?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(lead,getSessionForLead(lead.id))}</b>
      </button>)}
    </section>}

    {tab==="service"&&selected&&<section className="mobile-service-screen mobile-browser-service">
      <button className="mobile-inline-back" onClick={()=>setTab("route")}>← Back to Route</button>
      <div className="mobile-property-photo mobile-property-photo-browser">{selected.propertyPhoto?<img src={selected.propertyPhoto} alt="Property"/>:<span className="mobile-house-placeholder">🏠</span>}<a className="mobile-directions" href={mapsHref(selected.address)} target="_blank" rel="noopener noreferrer">Get directions</a></div>
      <span className="eyebrow">Service Details</span>
      <div className="mobile-service-head">
        <div><h1>{selected.address}</h1><p>{selected.name}</p></div>
        <b className={selected.status==="completed"?"mobile-status done":session?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(selected,session)}</b>
      </div>
      <div className="mobile-detail-list">
        <div><span>Client</span><strong>{selected.name}</strong></div>
        <div><span>Status</span><strong>{statusLabel(selected,session)}</strong></div>
        <div><span>Workflow</span><strong>{workflow?.label || "Assigned"}<small>{workflow?.nextAction || "Start job"}</small></strong></div>
        <div><span>Phone</span><strong>{selected.phone?<a href={`tel:${selected.phone}`}>{selected.phone}</a>:"-"}</strong></div>
        <div><span>Email</span><strong>{selected.email?<a href={`mailto:${selected.email}`}>{selected.email}</a>:"-"}</strong></div>
        <div><span>Address</span><strong>{selected.address||"-"}</strong></div>
      </div>
      <div className="mobile-service-info"><span>Service</span><strong>{selected.service}</strong><small>{selected.scheduledDate||"Season"} · {selected.scheduledWindow||"Flexible"}</small></div>
      <div className="mobile-detail-list compact">
        <div><span>Grass height</span><strong>{details?.grassHeight||"3in"}</strong></div>
        <div><span>Lot size</span><strong>{details?.lawnSize?.toUpperCase()||"SMALL"}</strong></div>
        <div><span>Backyard</span><strong>{details?.backyard?"Yes":"No"}</strong></div>
        <div><span>Gate</span><strong>{details?.gated?"Yes":"No"}</strong></div>
        <div><span>Access</span><strong>{details?.accessNotes||"-"}</strong></div>
        <div><span>Alerts</span><strong>{details?.propertyAlerts||"-"}</strong></div>
        <div><span>Admin notes</span><strong>{details?.adminNotes||selected.notes||"-"}</strong></div>
      </div>
      <div className="mobile-timer-card"><span>Timer</span><strong>{formatDuration(seconds)}</strong><small>{session?.status||"not started"}</small></div>
      <div className="mobile-action-grid">
        <button className="mobile-primary" disabled={busy||session?.status==="running"||selected.status==="completed"} onClick={start}>Start</button>
        <button className="mobile-finish" disabled={busy||session?.status!=="running"} onClick={finish}>Finish</button>
        <button className="mobile-reset" disabled={busy||(!session&&selected.status!=="completed")} onClick={reset}>Reset</button>
        <button className="mobile-skip" disabled={busy||selected.status==="completed"} onClick={openSkip}>Skip</button>
      </div>
      <textarea className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Optional comment for this visit" />
      <button className="mobile-outline" disabled={busy||!comment.trim()} onClick={saveNote}>Save Comment</button>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={upload}/>
      <button className="mobile-outline" disabled={busy||(selected.photos?.length||0)>=5} onClick={()=>photoInput.current?.click()}>Take / Upload Photo ({selected.photos?.length||0}/5)</button>
      {message&&<p className="mobile-message">{message}</p>}
    </section>}

    {skipOpen&&selected&&<div className="mobile-modal-backdrop" role="presentation" onClick={()=>!busy&&setSkipOpen(false)}>
      <section className="mobile-skip-modal" role="dialog" aria-modal="true" aria-labelledby="skip-title" onClick={e=>e.stopPropagation()}>
        <h2 id="skip-title">Skip this house?</h2>
        <p>The house will stay on the route in yellow and Admin/Dispatch will receive the update.</p>
        <label className="mobile-field-label" htmlFor="skip-comment">Comment (optional)</label>
        <textarea id="skip-comment" className="mobile-textarea" value={skipComment} onChange={e=>setSkipComment(e.target.value)} placeholder="Add any useful details for the office."/>
        <input ref={skipPhotoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={uploadSkipPhoto}/>
        <button className="mobile-outline" disabled={busy||skipPhotos.length>=5} onClick={()=>skipPhotoInput.current?.click()}>Add optional photo ({skipPhotos.length}/5)</button>
        {skipPhotos.length>0&&<div className="mobile-skip-photo-grid">{skipPhotos.map((photo,index)=><img key={index} src={photo} alt={`Skip evidence ${index+1}`}/>)}</div>}
        <div className="mobile-modal-actions"><button className="mobile-outline" disabled={busy} onClick={()=>setSkipOpen(false)}>Cancel</button><button className="mobile-skip" disabled={busy} onClick={confirmSkip}>Confirm Skip</button></div>
      </section>
    </div>}

    {tab==="issues"&&<section className="mobile-card-list">
      {tasks.length===0?<div className="mobile-empty"><strong>No return visits.</strong><p>Assigned issues will appear here.</p></div>:tasks.map(task=><article className="mobile-issue-card" key={task.id}>
        <strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>{task.description}</small>
        <div className="mobile-action-grid"><button className="mobile-primary" onClick={()=>{updateEmployeeTaskStatus(task.id,"in_progress"); setMessage("Task started."); refresh()}}>Start</button><button className="mobile-finish" onClick={()=>{if(window.confirm("Mark this return visit as completed? It will leave your account and go to Admin review.")){updateEmployeeTaskStatus(task.id,"completed","Completed from mobile app",profile.name); refresh()}}}>Complete</button></div>
      </article>)}
    </section>}
  </main>
}
