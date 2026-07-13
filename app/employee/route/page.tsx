"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { loadEmployeeOperationalIdentity } from "@/lib/services/employeeIdentityService";
import {
  finishServiceSession,
  formatClock,
  formatDuration,
  getEmployeeProfile,
  getEmployeeTasks,
  getLeads,
  getLeadWorkflowSnapshot,
  getSessionForLead,
  Lead,
  logoutEmployee,
  resetServiceSession,
  saveEmployeeProfile,
  saveServicePhotos,
  saveServiceComment,
  seedDemoLeads,
  DAMASIO_WEEK_DAYS,
  DAMASIO_SYNC_EVENT,
  seedEmployeeTasks,
  startServiceSession,
  returnEmployeeTaskToAdmin,
  updateEmployeeTaskStatus
} from "@/lib/storage";


function hasValidAddress(address?: string){
  return Boolean(address && address.trim().length > 5);
}
function mapsHref(address:string){
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}
function openNativeDirections(address:string,e:MouseEvent<HTMLAnchorElement>){
  const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(!isMobile)return;
  e.preventDefault();
  const q=encodeURIComponent(address);
  window.location.href=`geo:0,0?q=${q}`;
  window.setTimeout(()=>{window.location.href=mapsHref(address)},650);
}

function grassLabel(value?: string){
  if(value==="mulched")return "Mulched";
  if(value==="bag_green_bin")return "Bag to green bin";
  if(value==="bag_leave_property")return "Bag and leave";
  return "No preference";
}

export default function EmployeeRoutePage(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [selectedId,setSelectedId]=useState<string>("");
  const [crew,setCrew]=useState("");
  const [day,setDay]=useState("");
  const [view,setView]=useState<"route"|"map"|"details"|"tasks"|"summary">("route");
  const [tick,setTick]=useState(0);
  const [photoCount,setPhotoCount]=useState(0);
  const [tasks,setTasks]=useState(getEmployeeTasks());
  const [profile,setProfile]=useState(getEmployeeProfile());
  const [menuOpen,setMenuOpen]=useState(false);
  const [menuMessage,setMenuMessage]=useState("");
  const [notificationOpen,setNotificationOpen]=useState(false);
  const [notificationsSeen,setNotificationsSeen]=useState(false);
  const [commentOpen,setCommentOpen]=useState(false);
  const [serviceComment,setServiceComment]=useState("");
  const [doneMessage,setDoneMessage]=useState("");
  const [routeFilter,setRouteFilter]=useState("all");
  const photoInputRef=useRef<HTMLInputElement|null>(null);

  function refresh(){
    const rows=getLeads();
    setLeads(rows);
    setTasks(getEmployeeTasks());
    setProfile(getEmployeeProfile());
    if(!selectedId && rows[0]) setSelectedId(rows[0].id);
  }

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const qDay=params.get("day");
    const qProperty=params.get("property");
    const qView=params.get("view");
    void loadEmployeeOperationalIdentity().then(identity=>setCrew(identity.crew));
    const today=DAMASIO_WEEK_DAYS[(new Date().getDay()+6)%7];
    if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay))setDay(qDay);
    else setDay(today);
    refresh();
    if(qProperty){setSelectedId(qProperty);setView("details");}
    else if(qView==="map")setView("map");
    const on=()=>refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);
    window.addEventListener("storage",on);
    const timer=setInterval(()=>{if(document.visibilityState==="visible")refresh()},15000);
    return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);clearInterval(timer)}
  },[]);
  useEffect(()=>{
    const interval=setInterval(()=>setTick(v=>v+1),1000);
    return()=>clearInterval(interval);
  },[]);

  const allRouteLeads=useMemo(()=>leads.filter(l=>l.assignedCrew===crew && (!day || l.serviceDay===day)).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)),[leads,crew,day]);
  const routeLeads=useMemo(()=>allRouteLeads.filter(l=>routeFilter==="all"?true:routeFilter==="open"?l.status!=="completed":routeFilter==="done"?l.status==="completed":true),[allRouteLeads,routeFilter]);
  const selected=useMemo(()=>allRouteLeads.find(l=>l.id===selectedId)||allRouteLeads[0]||null,[allRouteLeads,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const openTasks=tasks.filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew));

  const runningSeconds=useMemo(()=>{
    if(!session)return 0;
    if(session.durationSeconds)return session.durationSeconds;
    if(session.startedAt&&session.status==="running"){
      return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    }
    return 0;
  },[session,tick]);

  function loadDemo(){
    seedDemoLeads(true);
    seedEmployeeTasks();
    const rows=getLeads();
    setLeads(rows);
    setTasks(getEmployeeTasks());
    const first=rows.find(l=>l.assignedCrew===crew && (!day || l.serviceDay===day))||rows[0];
    setSelectedId(first?.id||"");
  }

  function openLead(lead:Lead){
    setSelectedId(lead.id);
    setPhotoCount(lead.photos?.length||0);
    const existingSession=getSessionForLead(lead.id);
    setServiceComment(existingSession?.completionComment||"");
    setCommentOpen(Boolean(existingSession?.completionComment));
    setView("details");
  }

  function findLeadForTask(taskId:string){
    const task=tasks.find(t=>t.id===taskId);
    if(!task)return null;
    return leads.find(l=>l.id===task.leadId)
      || leads.find(l=>l.address.trim().toLowerCase()===task.address.trim().toLowerCase())
      || leads.find(l=>l.name.trim().toLowerCase()===task.customer.trim().toLowerCase())
      || null;
  }

  function openTask(taskId:string){
    const task=tasks.find(t=>t.id===taskId);
    if(!task)return;
    const lead=findLeadForTask(taskId);
    updateEmployeeTaskStatus(taskId,"in_progress");
    if(lead){
      setSelectedId(lead.id);
      setPhotoCount(lead.photos?.length||0);
      setView("details");
    } else {
      setMenuMessage("Property data is missing for this task. Admin must connect this issue to a real property before directions and service screen can open.");
      setView("tasks");
    }
    refresh();
  }

  function start(){ if(!selected)return; startServiceSession(selected.id,profile.name,crew); setCommentOpen(false); setServiceComment(""); setDoneMessage(""); refresh(); }
  function saveComment(){
    if(!selected)return;
    if(!serviceComment.trim()){setMenuMessage("Type a comment before saving.");return;}
    saveServiceComment(selected.id, serviceComment);
    setMenuMessage("Comment saved.");
    setCommentOpen(false);
    refresh();
  }
  function finish(){ if(!selected)return; if(!window.confirm("Complete this house and mark it as Done?")) return; finishServiceSession(selected.id,serviceComment); setDoneMessage("Done"); setServiceComment(""); setCommentOpen(false); refresh(); window.setTimeout(()=>{setDoneMessage("");setView("route")},850); }
  function reset(){ if(!selected)return; if(!window.confirm("Reset only this house? Status returns to Open across Admin, Dispatch and Employee Route."))return; resetServiceSession(selected.id); setDoneMessage("Reset to Open"); refresh(); }

  function addPhoto(){
    photoInputRef.current?.click();
  }

  function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>){
    if(!selected)return;
    const files=Array.from(e.target.files||[]);
    if(files.length===0)return;
    const existing=selected.photos||[];
    const slots=5-existing.length;
    if(slots<=0){setMenuMessage("Maximum 5 photos per service.");return;}
    const accepted=files.slice(0,slots);
    Promise.all(accepted.map(file=>new Promise<string>((resolve)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||file.name));
      reader.readAsDataURL(file);
    }))).then(images=>{
      const next=[...existing,...images].slice(0,5);
      saveServicePhotos(selected.id,next);
      setPhotoCount(next.length);
      setMenuMessage(`${images.length} photo(s) saved. Maximum 5 photos per service.`);
      refresh();
    });
    e.target.value="";
  }

  function saveProfile(){
    const label=(profile.name||"E").slice(0,1).toUpperCase();
    saveEmployeeProfile({...profile,photoLabel:label});
    setMenuMessage("Profile saved.");
    refresh();
  }

  function logout(){
    logoutEmployee();
    setMenuMessage("Logged out locally. Real login/logout will be connected when we add database/auth.");
  }

  const completed=allRouteLeads.filter(l=>l.status==="completed").length;
  function dateForDay(dayName:string){const current=(new Date().getDay()+6)%7;const target=DAMASIO_WEEK_DAYS.indexOf(dayName);const d=new Date();if(target>=0)d.setDate(d.getDate()+target-current);return d.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric", year:"numeric"});}
  const selectedDateLabel=dateForDay(day);
  const details=selected?.propertyDetails;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
  const unreadIssues=notificationsSeen?0:openTasks.length;
  

  return <div className="field-shell">
    <div className="field-topbar">
      <div className="field-brand-mini"><div className="field-brand-mark">D</div><div>Damasio Field</div></div>
      <div className="topbar-actions">
        <div className="notification-wrap"><button className="notification-button" onClick={()=>{setNotificationsSeen(true);setNotificationOpen(!notificationOpen)}}>🔔{unreadIssues>0&&<span className="notification-badge">{unreadIssues}</span>}</button>{notificationOpen&&<div className="notification-popover field"><strong>Notifications</strong>{openTasks.length===0?<p>No notifications right now.</p>:openTasks.map(t=><Link key={t.id} href={`/employee/property/${t.leadId}`}>• {t.title}<br/><small>{t.customer}</small></Link>)}</div>}</div>
        <div className="profile-menu-wrap">
          <button className="field-avatar" onClick={()=>setMenuOpen(!menuOpen)}>{profile.photoLabel||profile.name.slice(0,1)||"E"}</button>
          {menuOpen&&<div className="employee-menu">
            <h3>Employee Profile</h3>
            <div className="field"><label>Name</label><input className="input" value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></div>
            <div className="field"><label>Email</label><input className="input" value={profile.email} onChange={e=>setProfile({...profile,email:e.target.value})}/></div>
            <div className="field"><label>Photo / Initial</label><input className="input" maxLength={2} value={profile.photoLabel} onChange={e=>setProfile({...profile,photoLabel:e.target.value.toUpperCase()})}/></div>
            <button className="menu-action" onClick={saveProfile}>Save profile</button>
            <button className="menu-action" onClick={logout} style={{marginTop:8,color:"#b42318"}}>Log out</button>
            {menuMessage&&<div className="payment-message" style={{marginTop:10}}>{menuMessage}</div>}
          </div>}
        </div>
      </div>
    </div>

    <div className="field-nav-tabs">
      <button className={view==="route"?"field-nav-tab active":"field-nav-tab"} onClick={()=>setView("route")}>Route</button>
      <button className={view==="map"?"field-nav-tab active":"field-nav-tab"} onClick={()=>setView("map")}>Map</button>
      <button className={view==="tasks"?"field-nav-tab active":"field-nav-tab"} onClick={()=>setView("tasks")}>Service Issues {openTasks.length>0&&`(${openTasks.length})`}</button>
      <button className={view==="summary"?"field-nav-tab active":"field-nav-tab"} onClick={()=>setView("summary")}>Day Summary</button>
    </div>

    <div className="employee-route-filter">
      <div><strong>{crew}</strong><span>{selectedDateLabel} · {day} route</span></div>
      <span className="privacy-pill">Private route</span>
      <CompactFilter label="Route filter"><label><input type="radio" checked={routeFilter==="all"} onChange={()=>setRouteFilter("all")}/> All</label><label><input type="radio" checked={routeFilter==="open"} onChange={()=>setRouteFilter("open")}/> Open</label><label><input type="radio" checked={routeFilter==="done"} onChange={()=>setRouteFilter("done")}/> Done</label></CompactFilter>
      <div className="employee-assigned-crew"><small>Assigned crew</small><strong>{crew||"Loading…"}</strong></div>
      <select value={day} onChange={e=>{setDay(e.target.value);setSelectedId("")}}>{DAMASIO_WEEK_DAYS.map(d=><option key={d}>{d}</option>)}</select>
    </div>

    {view==="tasks"&&<main className="field-container">
      <div className="field-card" style={{padding:24}}>
        <span className="eyebrow">Notifications</span>
        <h1 className="field-title">Service Issues</h1>
        <p className="section-intro">Open the Service Screen first. Start/Finish only happens inside the property screen.</p>
        {openTasks.length===0&&tasks.length===0&&<button className="btn btn-primary" onClick={loadDemo}>Load Demo Tasks</button>}
        <div className="task-list">
          {openTasks.length===0?<div className="task-card"><h3>No open issues</h3><p>Completed tasks are removed from Employee and stay with Admin/Customer history until Admin resolves them.</p></div>:openTasks.map(task=><div className={task.priority==="urgent"?"task-card urgent":"task-card"} key={task.id}>
            <div className="task-header">
              <div>
                <span className={task.priority==="urgent"?"priority-pill urgent":"priority-pill"}>{task.priority}</span>
                <h2>{task.title}</h2>
                <p><strong>{task.customer}</strong><br/>{task.address}</p>
              </div>
              <span className="task-status">{task.status}</span>
            </div>
            <p>{task.description}</p>
            <div className="row">
              <button className="btn btn-primary" onClick={()=>openTask(task.id)}>Open Service Screen</button>
              <button className="btn btn-outline" onClick={()=>{if(window.confirm("Return this task to Admin so it can be reassigned?")){returnEmployeeTaskToAdmin(task.id);refresh()}}}>Return for Admin</button><button className="btn btn-outline" onClick={()=>{if(window.confirm("Are you sure this return task is completed? It will be removed from your list and sent to Admin for final Resolve.")){const note=window.prompt("What did you complete at this property?", "Return visit completed and customer issue fixed."); if(note!==null){updateEmployeeTaskStatus(task.id,"completed",note,"Employee");refresh()}}}}>Mark Completed</button>
            </div>
          </div>)}
        </div>
      </div>
    </main>}

    {view==="route"&&<main className="field-container">
      <div className="field-card">
        <div className="route-progress">
          <div className="route-bar"><div className="route-bar-fill" style={{width:`${allRouteLeads.length?completed/allRouteLeads.length*100:0}%`}}/></div>
          <div className="route-count">{allRouteLeads.length?`${completed}/${allRouteLeads.length}`:"0/0"}</div>
        </div>

        {allRouteLeads.length===0&&<div style={{padding:24}}>
          <h2>No route loaded for {crew} on {selectedDateLabel}</h2>
          <p>Admin can assign homes from Customers or Routes. This view updates when Admin changes the route.</p>
          <button className="btn btn-primary" onClick={loadDemo}>Load Demo Route</button>
        </div>}

        {routeLeads.map((lead,index)=><div className="route-list-item" key={lead.id} onClick={()=>openLead(lead)}>
          <div className="route-list-number">{index+1}</div>
          <div>
            <div className="route-list-address">{lead.address}</div>
            <div className="route-list-meta">{lead.name}<br/>{lead.service}</div>
          </div>
          <div className={lead.status==="completed"?"done-pill":"done-pill open"}>{lead.status==="completed"?"Done":"Open"}</div>
        </div>)}
      </div>
    </main>}

    {view==="map"&&<main className="employee-web-map-shell">
      <aside className="employee-web-map-sidebar">
        <div className="employee-web-map-sidebar-head"><span className="eyebrow">Today&apos;s route</span><strong>{routeLeads.length} visits</strong><small>{completed} completed</small></div>
        <div className="employee-web-map-route-list">
          {routeLeads.map((lead,index)=>{
            const leadSession=getSessionForLead(lead.id);
            const attention=tasks.some(task=>task.leadId===lead.id&&task.status!=="resolved");
            const nextId=routeLeads.find(item=>item.status!=="completed"&&getSessionForLead(item.id)?.status!=="skipped")?.id;
            const state=attention?"attention":leadSession?.status==="skipped"?"skipped":lead.status==="completed"?"completed":lead.id===nextId?"next":"pending";
            return <button type="button" key={lead.id} className={`employee-web-map-route-item ${state}`} onClick={()=>openLead(lead)}>
              <span>{index+1}</span><div><strong>{lead.address||"Not mapped"}</strong><small>{lead.service}</small></div><em>{state==="attention"?"Needs attention":state==="next"?"Next visit":state}</em>
            </button>;
          })}
          {routeLeads.length===0&&<div className="employee-web-map-empty">No visits assigned to this route.</div>}
        </div>
      </aside>
      <EmployeeRouteMap route={routeLeads} onOpenVisit={openLead} desktop />
    </main>}

    {view==="summary"&&<main className="field-container">
      <div className="field-card" style={{padding:24}}>
        <span className="eyebrow">Today</span>
        <h1 className="field-title">Day Summary</h1>
        <div className="timer-grid">
          <div className="timer-box"><div className="timer-label">Jobs</div><div className="timer-value">{allRouteLeads.length}</div></div>
          <div className="timer-box"><div className="timer-label">Completed</div><div className="timer-value">{completed}</div></div>
          <div className="timer-box"><div className="timer-label">Open Issues</div><div className="timer-value">{openTasks.length}</div></div>
        </div>
      </div>
    </main>}

    {view==="details"&&selected&&<main className="field-container">
      <div className="house-image">
        {selected.propertyPhoto?<img src={selected.propertyPhoto} alt="Official property"/>:<div className="house-placeholder">🏠</div>}
        {hasValidAddress(selected.address)?<a className="direction-btn" href={mapsHref(selected.address)} onClick={(e)=>openNativeDirections(selected.address,e)} target="_blank" rel="noopener noreferrer">Get directions</a>:<span className="direction-btn disabled">Address missing</span>}
      </div>

      <span className="eyebrow">Service Screen</span>
      <h1 className="field-title">{selected.address}</h1>
      {doneMessage&&<div className="done-confirmation">✅ {doneMessage}</div>}

      <div className="details-table">
        <div className="details-row"><span>Client</span><span>{selected.name}</span></div>
        <div className="details-row"><span>Status</span><span>{selected.status==="completed"?"Done":"Open"}</span></div>
        <div className="details-row"><span>Workflow</span><span>{workflow?.label || "Assigned"} · {workflow?.nextAction || "Start job"}</span></div>
        <div className="details-row"><span>Phone</span><span>{selected.phone||"-"}</span></div>
        <div className="details-row"><span>Email</span><span>{selected.email||"-"}</span></div>
        <div className="details-row"><span>Full address</span><span>{selected.address||"Address not set"}</span></div>
      </div>

      <h2>Service</h2>
      <div className="contract-row">
        <div className="contract-icon">🌱</div>
        <div><h2 style={{margin:0}}>{selected.service}</h2><p style={{margin:"6px 0 0",color:"#6b7280"}}>{selected.scheduledDate||"Season"} • {selected.scheduledWindow||"Flexible"}</p></div>
      </div>

      {details?.propertyAlerts&&<div className="info-blue">⚠️ {details.propertyAlerts}</div>}

      <div className="details-table">
        <div className="details-row"><span>Grass height</span><span>{details?.grassHeight||"3in"}</span></div>
        <div className="details-row"><span>Grass clippings</span><span>{grassLabel(details?.grassHandling)}</span></div>
        <div className="details-row"><span>Lot Size</span><span>{details?.lawnSize?.toUpperCase()||"SMALL"}</span></div>
        <div className="details-row"><span>Backyard</span><span>{details?.backyard?"Yes":"No"}</span></div>
        <div className="details-row"><span>Gate</span><span>{details?.gated?"Yes":"No"}</span></div>
        <div className="details-row"><span>Access</span><span>{details?.accessNotes||"-"}</span></div>
      </div>

      {details?.adminNotes&&<div className="admin-note-box"><strong>Internal Notes</strong><br/>{details.adminNotes}</div>}

      <h2>{selectedDateLabel}</h2>
      <div className="field-card timer-focus">
        <div className={session?.status==="running"?"timer-status running":session?.status==="finished"?"timer-status finished":"timer-status"}>{session?.status==="running"?"IN PROGRESS":session?.status==="finished"?"DONE":"NOT STARTED"}</div>
        <div className="timer-big">{formatDuration(runningSeconds)}</div>
        <div className="timer-grid">
          <div className="timer-box"><div className="timer-label">Started</div><div className="timer-value">{formatClock(session?.startedAt)}</div></div>
          <div className="timer-box"><div className="timer-label">Finished</div><div className="timer-value">{formatClock(session?.finishedAt)}</div></div>
        </div>
      </div>

      <div className="row" style={{marginBottom:12}}>
        <button className="start-btn" onClick={start} disabled={session?.status==="running"}>Start</button>
        <button className="btn btn-outline" onClick={()=>setCommentOpen(!commentOpen)}>💬 Comment</button>
        <button className="finish-btn" onClick={finish} disabled={!session||session.status==="finished"}>Finish</button>
      </div>
      {commentOpen&&<div className="field-card" style={{padding:16,marginBottom:20}}>
        <label className="feedback-label">Optional employee comment</label>
        <textarea className="input" rows={3} value={serviceComment} onChange={e=>setServiceComment(e.target.value)} placeholder="Add a short note only if needed."/>
        <div className="row" style={{marginTop:12}}>
          <button className="btn btn-primary" onClick={saveComment}>Save Comment</button>
          <button className="btn btn-outline" onClick={()=>setCommentOpen(false)}>Cancel</button>
        </div>
      </div>}
      {session?.completionComment&&<div className="admin-note-box"><strong>Completion Comment</strong><br/>{session.completionComment}</div>}

      <h2>Service Photos</h2>
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple style={{display:"none"}} onChange={handlePhotoUpload}/>
      <div className="field-photo-grid">
        {[0,1,2,3,4].map(i=>{const photo=selected.photos?.[i];return <button key={i} className={photo?"field-photo filled":"field-photo"} onClick={addPhoto} disabled={(selected.photos?.length||0)>=5 && !photo}>{photo&&photo.startsWith("data:image")?<img src={photo} alt={`Service photo ${i+1}`}/>:photo?`Photo ${i+1}`:"+ Photo"}</button>})}
      </div>
      <p className="section-intro">Tap Photo to take a picture or upload from gallery/media. Maximum 5 photos per service.</p>

      <h2>Customer feedback</h2>
      <div className="feedback-grid">
        <div className="feedback-card"><div className="feedback-label">Rating</div><div className="feedback-value">{selected.feedback?`${selected.feedback.rating} ★`:"-"}</div></div>
        <div className="feedback-card"><div className="feedback-label">Tip</div><div className="feedback-value">{selected.feedback?`$${selected.feedback.tipAmount}`:"-"}</div></div>
      </div>
      <div className="feedback-card" style={{marginTop:16}}><div className="feedback-label">Comments</div><div className="feedback-value">{selected.feedback?.comment||"-"}</div></div>
    </main>}

    <div className="bottom-actions">
      {view==="details"?<button className="reset-btn" onClick={reset}>Reset House</button>:<button className="reset-btn" onClick={loadDemo}>Load Demo</button>}
      {view==="details"?<button className="route-btn" onClick={()=>setView("route")}>Back Route</button>:<Link className="route-btn" href="/employee" style={{textAlign:"center"}}>Exit</Link>}
    </div>
  </div>
}
