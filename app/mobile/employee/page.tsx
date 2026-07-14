"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { loadEmployeeOperationalIdentity } from "@/lib/services/employeeIdentityService";
import { applyEmployeeRouteMapContext, loadEmployeeRouteMapContext, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";
import {
  DAMASIO_SYNC_EVENT,
  DAMASIO_WEEK_DAYS,
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
function timeLabel(value?:string){return value?new Date(value).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"}):"—"}
function handlingLabel(value?:string){return ({mulched:"Mulched",bag_green_bin:"Green bin",bag_leave_property:"Bagged",no_preference:"No preference"} as Record<string,string>)[value||""]||"No preference"}

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
    }catch{
      setError("Route data is temporarily unavailable.");
      setLeads([]);
    }
  }

  useMobileRealtime(refresh);
  useEffect(()=>{refresh(); void loadEmployeeOperationalIdentity().then(identity=>setCrew(identity.crew)); const on=()=>refresh(); window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener); window.addEventListener("storage",on); const t=window.setInterval(()=>setTick(v=>v+1),1000); return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);window.clearInterval(t)}},[]);

  const todayDay=DAMASIO_WEEK_DAYS[(new Date().getDay()+6)%7];
  const localRoute=useMemo(()=>leads.filter(l=>l.assignedCrew===crew&&l.serviceDay===todayDay).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)),[leads,crew,todayDay]);
  useEffect(()=>{let cancelled=false;void loadEmployeeRouteMapContext(routeDateForWeekday(todayDay),crew).then(context=>{if(!cancelled)setMapContext(context)});return()=>{cancelled=true}},[crew,todayDay]);
  const route=useMemo(()=>applyEmployeeRouteMapContext(localRoute,mapContext),[localRoute,mapContext]);
  const mapRoute=route;
  const selected=useMemo(()=>route.find(l=>l.id===selectedId)||route[0]||null,[route,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
  const details=selected?.propertyDetails;
  const seconds=useMemo(()=>{
    if(!session)return 0;
    if(session.status==="running"&&session.startedAt)return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return session.durationSeconds||0;
  },[session,tick]);
  const tasks=useMemo(()=>{
    try{return getEmployeeTasks().filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew))}
    catch{return []}
  },[leads,profile.name,crew,tick]);
  const done=route.filter(l=>l.status==="completed").length;
  const skipped=route.filter(l=>getSessionForLead(l.id)?.status==="skipped").length;
  const progress=route.length?Math.round((done/route.length)*100):0;
  const nextStop=route.find(l=>l.status!=="completed"&&getSessionForLead(l.id)?.status!=="skipped")||route[0]||null;

  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setContractOpen(true); setTab("service"); setMessage("")}
  function start(){
    if(!selected||busy)return;
    setBusy(true); setError("");
    try{startServiceSession(selected.id,profile.name,crew); refresh(); setMessage("Service started.")}
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

  return <main className="mobile-app-shell">
    <header className="mobile-topbar employee-mobile-topbar">
      <div className="employee-mobile-brand"><span>D</span><div><strong>Employee</strong><small>{profile.name || "Field user"} · {crew}</small></div></div>
      <div className="mobile-avatar">{(profile.photoLabel||profile.name||"E").slice(0,1)}</div>
    </header>

    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}

    <section className="employee-mobile-progress">
      <div><strong>Today&apos;s Route</strong><span>{done} / {route.length} completed</span></div>
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

    {tab==="service"&&selected&&<section className="mobile-service-screen mobile-browser-service">
      <button className="mobile-inline-back" onClick={()=>setTab("route")}>← Route</button>
      <div className="mobile-property-photo mobile-property-photo-browser">{selected.propertyPhoto?<img src={selected.propertyPhoto} alt="Property"/>:<span className="mobile-house-placeholder">🏠</span>}<a className="mobile-directions" href={mapsHref(selected.address)} target="_blank" rel="noopener noreferrer">Get directions</a></div>
      <div className="mobile-service-head">
        <div><h1>{selected.address}</h1><p>{selected.name}</p></div>
        <b className={selected.status==="completed"?"mobile-status done":session?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(selected,session)}</b>
      </div>
      <div className="employee-video-row"><span>Client</span><strong>{selected.name}</strong></div>
      <section className="employee-contract-card">
        <button type="button" onClick={()=>setContractOpen(value=>!value)}><span>Contract</span><b>{contractOpen?"Hide details":"Show details"}</b></button>
        <div className="employee-contract-service"><i>✂</i><div><strong>{selected.service}</strong><small>{selected.scheduledDate||"Season"} · {selected.scheduledWindow||"Flexible"}</small></div></div>
        {contractOpen&&<>
          {(details?.accessNotes||details?.propertyAlerts||details?.adminNotes||selected.notes)&&<div className="employee-access-note">ⓘ {details?.accessNotes||details?.propertyAlerts||details?.adminNotes||selected.notes}</div>}
          <div className="mobile-detail-list compact employee-contract-details">
            <div><span>Cut height</span><strong>{details?.grassHeight||"3in"}</strong></div>
            <div><span>Grass clippings</span><strong>{handlingLabel(details?.grassHandling)}</strong></div>
            <div><span>Lot size</span><strong>{details?.lawnSize?.toUpperCase()||"SMALL"}</strong></div>
            <div><span>Backyard</span><strong>{details?.backyard?"Yes":"No"}</strong></div>
            <div><span>Gate</span><strong>{details?.gated?"Yes":"No"}</strong></div>
            <div><span>Workflow</span><strong>{workflow?.label||"Assigned"}</strong></div>
          </div>
        </>}
      </section>
      <div className="employee-contact-actions">
        {selected.phone&&<a href={`tel:${selected.phone}`}>Call client</a>}
        {selected.email&&<a href={`mailto:${selected.email}`}>Email client</a>}
      </div>
      <div className="employee-visit-date">{selected.scheduledDate||"Today"}</div>
      <div className="employee-time-grid">
        <div><span>Started</span><strong>{timeLabel(session?.startedAt)}</strong></div>
        <div><span>Duration</span><strong>{formatDuration(seconds)}</strong></div>
        <div><span>Finished</span><strong>{timeLabel(session?.finishedAt)}</strong></div>
      </div>
      {(selected.photos?.length||0)>0&&<section className="employee-image-section"><strong>Images</strong><div>{selected.photos?.map((photo,index)=><img key={index} src={photo} alt={`Service ${index+1}`}/>)}</div></section>}
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
      <div className="employee-service-footer"><button className="mobile-reset" disabled={busy||(!session&&selected.status!=="completed")} onClick={reset}>Reset ↻</button><button className="mobile-primary" onClick={()=>setTab("route")}>Route</button></div>
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
