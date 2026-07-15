"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { loadEmployeeOperationalIdentity } from "@/lib/services/employeeIdentityService";
import { applyEmployeeRouteMapContext, loadEmployeeRouteMapContext, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";
import {
  DAMASIO_SYNC_EVENT,
  DAMASIO_WEEK_DAYS,
  Lead,
  dayNameFromDate,
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
import { changeVisitStatus } from "@/lib/services/schedulingService";
import {signOutAccount} from "@/lib/auth/signOut";

function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}
function statusLabel(lead:Lead, session?:ReturnType<typeof getSessionForLead>){return lead.status==="completed"?"Done":session?.status==="skipped"?"Skipped":"Open"}
function timeLabel(value?:string){return value?new Date(value).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"}):"—"}
function handlingLabel(value?:string){return ({mulched:"Mulched",bag_green_bin:"Green bin",bag_leave_property:"Bagged",no_preference:"No preference"} as Record<string,string>)[value||""]||"No preference"}
function localDateKey(date:Date){const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,"0");const day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`}
function mondayKey(date:Date){const monday=new Date(date);const day=(monday.getDay()+6)%7;monday.setDate(monday.getDate()-day);return localDateKey(monday)}
function shiftDateKey(value:string,days:number){const date=new Date(`${value}T12:00:00`);date.setDate(date.getDate()+days);return localDateKey(date)}

export default function MobileEmployeeApp(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [tab,setTab]=useState<"route"|"service"|"issues">("route");
  const [routeView,setRouteView]=useState<"list"|"map">("list");
  const [comment,setComment]=useState("");
  const [tick,setTick]=useState(0);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [skipOpen,setSkipOpen]=useState(false);
  const [contractOpen,setContractOpen]=useState(true);
  const [selectedDate,setSelectedDate]=useState(()=>localDateKey(new Date()));
  const [weekStart,setWeekStart]=useState(()=>mondayKey(new Date()));
  const [routeReload,setRouteReload]=useState(0);
  const [skipComment,setSkipComment]=useState("");
  const [skipPhotos,setSkipPhotos]=useState<string[]>([]);
  const skipPhotoInput=useRef<HTMLInputElement|null>(null);
  const photoInput=useRef<HTMLInputElement|null>(null);
  const profile=getEmployeeProfile();
  const [crew,setCrew]=useState(profile.crew||"Crew A");
  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});

  function refresh(){
    try{
      seedDemoLeads();
      const rows=getLeads();
      setLeads(rows);
      setError("");
      setSelectedId(current=>current&&rows.some(row=>row.id===current)?current:(rows[0]?.id||""));
      setRouteReload(value=>value+1);
    }catch{
      setError("Route data is temporarily unavailable.");
      setLeads([]);
    }
  }

  useMobileRealtime(refresh);
  useEffect(()=>{refresh(); void loadEmployeeOperationalIdentity().then(identity=>setCrew(identity.crew)); const on=()=>refresh(); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); const t=window.setInterval(()=>setTick(v=>v+1),1000); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);window.clearInterval(t)}},[]);

  const todayKey=localDateKey(new Date());
  const selectedDay=dayNameFromDate(selectedDate);
  const localRoute=useMemo(()=>leads.filter(l=>l.assignedCrew===crew&&(l.scheduledDate===selectedDate||(selectedDate===todayKey&&l.serviceDay===selectedDay))).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)),[leads,crew,selectedDate,selectedDay,todayKey]);
  useEffect(()=>{let cancelled=false;void loadEmployeeRouteMapContext(selectedDate,crew).then(context=>{if(!cancelled)setMapContext(context)});return()=>{cancelled=true}},[crew,selectedDate,routeReload]);
  const route=useMemo(()=>applyEmployeeRouteMapContext(localRoute,mapContext),[localRoute,mapContext]);
  const mapRoute=route;
  const dayOptions=useMemo(()=>Array.from({length:7},(_,index)=>{const date=new Date(`${weekStart}T12:00:00`);date.setDate(date.getDate()+index);return{key:localDateKey(date),weekday:date.toLocaleDateString("en-CA",{weekday:"short"}),day:date.getDate()}}),[weekStart]);
  const weekLabel=`${new Date(`${weekStart}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})} – ${new Date(`${shiftDateKey(weekStart,6)}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}`;
  function moveWeek(days:-7|7){setWeekStart(current=>shiftDateKey(current,days));setSelectedDate(current=>shiftDateKey(current,days));setSelectedId("");setTab("route")}
  const selected=useMemo(()=>route.find(l=>l.id===selectedId)||route[0]||null,[route,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
  const details=selected?.propertyDetails;
  const seconds=useMemo(()=>{
    if(!session){
      if(selected?.visitDurationSeconds)return selected.visitDurationSeconds;
      const started=selected?.visitStartedAt?new Date(selected.visitStartedAt).getTime():0;
      const finished=selected?.visitFinishedAt?new Date(selected.visitFinishedAt).getTime():0;
      if(started)return Math.max(0,Math.round(((finished||Date.now())-started)/1000));
      return 0;
    }
    if(session.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return session.durationSeconds||0;
  },[session,tick,selected?.visitDurationSeconds,selected?.visitStartedAt,selected?.visitFinishedAt]);
  const tasks=useMemo(()=>{
    try{return getEmployeeTasks().filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew))}
    catch{return []}
  },[leads,profile.name,crew,tick]);
  const done=route.filter(l=>l.status==="completed").length;
  const skipped=route.filter(l=>getSessionForLead(l.id)?.status==="skipped").length;
  const progress=route.length?Math.round((done/route.length)*100):0;
  const nextStop=route.find(l=>l.status!=="completed"&&getSessionForLead(l.id)?.status!=="skipped")||route[0]||null;

  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setContractOpen(true); setTab("service"); setMessage("")}
  async function start(){
    if(!selected||busy)return;
    setBusy(true); setError("");
    try{if(selected.canonicalVisitId)await changeVisitStatus(selected.canonicalVisitId,"in_progress");else startServiceSession(selected.id,profile.name,crew); setRouteReload(value=>value+1); refresh(); setMessage("Service started and synchronized.")}
    catch{setError("Service could not be started. Please try again.")}
    finally{setBusy(false)}
  }
  async function finish(){
    if(!selected||busy)return;
    if(!window.confirm("Finish this service and mark this house as Done?"))return;
    setBusy(true); setError("");
    try{if(selected.canonicalVisitId)await changeVisitStatus(selected.canonicalVisitId,"completed");else finishServiceSession(selected.id,comment); setRouteReload(value=>value+1); refresh(); setMessage("Done. Every device was updated.")}
    catch{setError("Service could not be completed. Please try again.")}
    finally{setBusy(false)}
  }
  async function reset(){
    if(!selected||busy)return;
    if(!window.confirm("Reset this house? The timer will be cleared and the visit will return to Open."))return;
    setBusy(true); setError("");
    try{if(selected.canonicalVisitId)await changeVisitStatus(selected.canonicalVisitId,"scheduled");else resetServiceSession(selected.id); setComment(""); setRouteReload(value=>value+1); refresh(); setMessage("House reset to Open on every device.")}
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
    try{skipServiceSession(selected.id,skipComment,skipPhotos,profile.name,crew); setSkipOpen(false); refresh(); setMessage("House skipped. Admin and Dispatch were notified."); setTab("route")}
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

  return <MobileRoleGuard allowed={["employee"]}><main className="mobile-app-shell">
    <header className="mobile-topbar employee-mobile-topbar">
      <div className="employee-mobile-brand"><span>D</span><div><strong>Employee</strong><small>{profile.name || "Field user"} · {crew}</small></div></div>
      <button type="button" className="mobile-avatar mobile-signout" onClick={()=>void signOutAccount("/mobile/login")} aria-label="Sign out">{(profile.photoLabel||profile.name||"E").slice(0,1)}</button>
    </header>

    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}

    <section className="employee-week-picker">
      <div><button type="button" aria-label="Previous week" onClick={()=>moveWeek(-7)}>‹</button><strong>{weekLabel}</strong><button type="button" aria-label="Next week" onClick={()=>moveWeek(7)}>›</button></div>
      <nav className="employee-day-strip" aria-label="Route days">
        {dayOptions.map(item=><button key={item.key} className={selectedDate===item.key?"active":item.key<todayKey?"past":""} onClick={()=>{setSelectedDate(item.key);setSelectedId("");setTab("route")}}><span>{item.weekday}</span><strong>{item.day}</strong>{item.key===todayKey&&<i>Today</i>}</button>)}
      </nav>
    </section>

    <section className="employee-mobile-progress">
      <div><strong>{selectedDate===todayKey?"Today’s Route":new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}</strong><span>{done} / {route.length} completed</span></div>
      <div className="employee-progress-track"><i style={{width:`${progress}%`}}/></div>
      <small>{route.length-done-skipped} remaining · {skipped} skipped · {tasks.length} issues</small>
    </section>

    <nav className="mobile-tabs mobile-tabs-two">
      <button className={tab==="route"||tab==="service"?"active":""} onClick={()=>setTab("route")}>Today&apos;s Route</button>
      <button className={tab==="issues"?"active":""} onClick={()=>setTab("issues")}>Tasks {tasks.length>0&&<b>{tasks.length}</b>}</button>
    </nav>

    {tab==="route"&&<>
      <div className="employee-route-view-toggle" role="tablist" aria-label="Route view">
        <button type="button" className={routeView==="list"?"active":""} onClick={()=>setRouteView("list")}>List</button>
        <button type="button" className={routeView==="map"?"active":""} onClick={()=>setRouteView("map")}>Map</button>
      </div>
      {routeView==="list"?<section className="mobile-card-list">
        {route.map((lead,index)=><button className={`mobile-route-card employee-video-route-card ${lead.status==="completed"?"completed":""}`} key={lead.id} onClick={()=>openService(lead)}>
          <span className="mobile-route-index">{index+1}</span>
          <div><strong>{lead.address}</strong><p>{lead.name}</p><em>{lead.service} · {lead.serviceFrequency||"weekly"}</em></div>
          <b className={lead.status==="completed"?"mobile-status done":getSessionForLead(lead.id)?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(lead,getSessionForLead(lead.id))}</b>
        </button>)}
      </section>:<EmployeeRouteMap route={mapRoute} routeId={mapContext.routeId||undefined} onOpenVisit={openService}/>}
      {routeView==="list"&&nextStop&&<a className="employee-next-directions" href={mapsHref(nextStop.address)} target="_blank" rel="noopener noreferrer"><span>Get directions to next</span><b>⌖</b></a>}
    </>}

    {tab==="service"&&selected&&<section className="mobile-service-screen mobile-browser-service mobile-property-reference">
      <button className="mobile-inline-back" onClick={()=>setTab("route")}>← Route</button>
      <div className="mobile-service-head">
        <div><h1>{selected.address}</h1><p>{selected.name}</p></div>
        <b className={selected.status==="completed"?"mobile-status done":session?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(selected,session)}</b>
      </div>
      <div className="property-reference-head mobile-property-contract-head"><h2>Contract</h2><button type="button" onClick={()=>setContractOpen(value=>!value)}>{contractOpen?"Hide details":"Show details"}</button></div>
      <article className="property-contract-summary"><div className="property-contract-thumb">{selected.propertyPhoto?<img src={selected.propertyPhoto} alt="Property"/>:<span>🏡</span>}</div><div><strong>{selected.service}</strong><small>{selected.serviceFrequency||"one time"} · {selected.scheduledDate||"Route pending"}</small></div><i>ⓘ</i></article>
      {contractOpen&&<article className="property-compact-card mobile-property-data-card">
        {(details?.accessNotes||details?.propertyAlerts||details?.adminNotes||selected.notes)&&<div className="property-access-banner">ⓘ {details?.accessNotes||details?.propertyAlerts||details?.adminNotes||selected.notes}</div>}
        <dl><div><dt>Cut height</dt><dd>{(details?.grassHeight||"3in").replace("in","")} inches</dd></div><div><dt>Grass clippings</dt><dd>{handlingLabel(details?.grassHandling)}</dd></div><div><dt>Lot size</dt><dd>{details?.lawnSize?.toUpperCase()||"SMALL"}</dd></div><div><dt>Service level</dt><dd>{selected.serviceFrequency||"One time"}</dd></div><div><dt>Backyard / gate</dt><dd>{details?.backyard?"Backyard":"No backyard"} · {details?.gated?"Gated":"Open"}</dd></div><div><dt>Workflow</dt><dd>{workflow?.label||"Assigned"}</dd></div></dl>
      </article>}
      <div className="employee-contact-actions">
        {selected.phone&&<a href={`tel:${selected.phone}`}>Call client</a>}
        {selected.email&&<a href={`mailto:${selected.email}`}>Email client</a>}
      </div>
      <div className="employee-visit-date">{selected.scheduledDate||"Today"}</div>
      <div className="employee-time-grid">
        <div><span>Started</span><strong>{timeLabel(session?.startedAt||selected.visitStartedAt)}</strong></div>
        <div><span>Duration</span><strong>{formatDuration(seconds)}</strong></div>
        <div><span>Finished</span><strong>{timeLabel(session?.finishedAt||selected.visitFinishedAt)}</strong></div>
      </div>
      <section className="employee-image-section"><strong>Images</strong><div>{[selected.propertyPhoto,...(selected.photos||[])].filter(Boolean).map((photo,index)=><img key={index} src={photo} alt={`Service ${index+1}`}/>)}{!selected.propertyPhoto&&!(selected.photos?.length)&&<span className="mobile-property-no-images">No images yet</span>}</div></section>
      <div className="mobile-action-grid">
        <button className="mobile-primary" disabled={busy||session?.status==="running"||selected.status==="completed"} onClick={start}>Start</button>
        <button className="mobile-finish" disabled={busy||(!selected.canonicalVisitId&&session?.status!=="running")||(Boolean(selected.canonicalVisitId)&&!selected.visitStartedAt)||selected.status==="completed"} onClick={finish}>Finish</button>
        <button className="mobile-reset" disabled={busy||(!session&&!selected.canonicalVisitId&&selected.status!=="completed")} onClick={reset}>Reset</button>
        <button className="mobile-skip" disabled={busy||selected.status==="completed"} onClick={openSkip}>Skip</button>
      </div>
      <textarea className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Optional comment for this visit" />
      <button className="mobile-outline" disabled={busy||!comment.trim()} onClick={saveNote}>Save Comment</button>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={upload}/>
      <button className="mobile-outline" disabled={busy||(selected.photos?.length||0)>=5} onClick={()=>photoInput.current?.click()}>Take / Upload Photo ({selected.photos?.length||0}/5)</button>
      {message&&<p className="mobile-message">{message}</p>}
      <div className="employee-service-footer"><button className="mobile-reset" disabled={busy||(!session&&!selected.canonicalVisitId&&selected.status!=="completed")} onClick={reset}>Reset ↻</button><button className="mobile-primary" onClick={()=>setTab("route")}>Route</button></div>
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
  </main></MobileRoleGuard>
}
