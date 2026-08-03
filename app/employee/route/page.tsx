"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { loadEmployeeOperationalIdentity } from "@/lib/services/employeeIdentityService";
import { applyEmployeeRouteMapContext, employeeRouteMapContextFromSnapshot, loadEmployeeRouteMapContextUntilStatus, routeDateForWeekday, type EmployeeRouteMapContext } from "@/lib/services/routeMapService";
import { useCanonicalRouteSnapshot } from "@/lib/hooks/useCanonicalRouteSnapshot";
import {runVisitStatusOrQueue} from "@/lib/mobile/offlineActionQueue";
import type { CanonicalRouteLead } from "@/lib/routes/canonicalRouteIdentity";
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
  DAMASIO_WEEK_DAYS,
  DAMASIO_SYNC_EVENT,
  startServiceSession,
  returnEmployeeTaskToAdmin,
  updateEmployeeTaskStatus
} from "@/lib/storage";

function localDateKey(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function mondayKey(date:Date){const monday=new Date(date);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);return localDateKey(monday)}
function shiftDate(value:string,days:number){const date=new Date(`${value}T12:00:00`);date.setDate(date.getDate()+days);return localDateKey(date)}


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
  const [selectedDate,setSelectedDate]=useState(()=>localDateKey(new Date()));
  const [weekStart,setWeekStart]=useState(()=>mondayKey(new Date()));
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
  const [mapContext,setMapContext]=useState<EmployeeRouteMapContext>({routeId:null,stops:[]});
  const [routeStartAddress,setRouteStartAddress]=useState("");
  const [routeOrigin,setRouteOrigin]=useState<{latitude:number;longitude:number;label:string}|null>(null);
  const photoInputRef=useRef<HTMLInputElement|null>(null);
  const verifiedExecutionRef=useRef(new Map<string,{
    status:string;
    startedAt?:string;
    finishedAt?:string;
    durationSeconds?:number;
  }>());

  function acceptCanonicalContext(context:EmployeeRouteMapContext){
    const rank=(status:string)=>status==="completed"||status==="missed"?2:status==="in_progress"?1:0;
    const stops=context.stops.map(stop=>{
      const verified=verifiedExecutionRef.current.get(stop.visitId);
      if(!verified)return stop;
      if(stop.status===verified.status||rank(stop.status)>rank(verified.status)){
        verifiedExecutionRef.current.delete(stop.visitId);
        return stop;
      }
      return {...stop,...verified};
    });
    setMapContext({...context,stops});
  }

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
    void loadEmployeeOperationalIdentity().then(identity=>{setCrew(identity.crew);setRouteStartAddress(identity.routeStartAddress||"")});
    const clientNow=new Date();
    const clientToday=localDateKey(clientNow);
    const clientWeekStart=mondayKey(clientNow);
    const today=DAMASIO_WEEK_DAYS[(clientNow.getDay()+6)%7];
    setWeekStart(clientWeekStart);
    if(qDay&&DAMASIO_WEEK_DAYS.includes(qDay)){setDay(qDay);setSelectedDate(routeDateForWeekday(qDay));}
    else {setDay(today);setSelectedDate(clientToday);}
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

  const localRouteLeads=useMemo(()=>leads.filter(l=>l.assignedCrew===crew&&(l.scheduledDate===selectedDate||l.nextVisitDate===selectedDate||l.serviceDay===day)).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)),[leads,crew,day,selectedDate]);
  const {snapshot:liveRouteSnapshot,error:liveRouteError}=useCanonicalRouteSnapshot({routeDate:selectedDate});
  useEffect(()=>{
    if(liveRouteSnapshot)acceptCanonicalContext(employeeRouteMapContextFromSnapshot(liveRouteSnapshot));
  },[liveRouteSnapshot]);
  useEffect(()=>{
    if(liveRouteError&&!/not found|no canonical route/i.test(liveRouteError))setMenuMessage(liveRouteError);
  },[liveRouteError]);
  useEffect(()=>{let cancelled=false;if(!routeStartAddress){setRouteOrigin(null);return()=>{cancelled=true}}void fetch(`/api/map/geocode?address=${encodeURIComponent(routeStartAddress)}`,{cache:"no-store"}).then(response=>{if(!response.ok)throw new Error("not mapped");return response.json()}).then((point:{latitude:number;longitude:number})=>{if(!cancelled)setRouteOrigin({...point,label:`${profile.name||"Employee"} start`})}).catch(()=>{if(!cancelled)setRouteOrigin(null)});return()=>{cancelled=true}},[routeStartAddress,profile.name]);
  const allRouteLeads=useMemo(()=>applyEmployeeRouteMapContext(localRouteLeads,mapContext) as CanonicalRouteLead[],[localRouteLeads,mapContext]);
  const routeLeads=useMemo(()=>allRouteLeads.filter(l=>routeFilter==="all"?true:routeFilter==="open"?l.status!=="completed":routeFilter==="done"?l.status==="completed":true),[allRouteLeads,routeFilter]);
  const mapRouteLeads=routeLeads;
  const selected=useMemo(()=>allRouteLeads.find(l=>l.id===selectedId)||allRouteLeads[0]||null,[allRouteLeads,selectedId]);
  const session=selected?getSessionForLead(selected.id):null;
  const canonicalActive=Boolean(selected?.canonicalVisitId)&&(
    selected?.canonicalVisitStatus==="in_progress"
    || (selected?.canonicalVisitStatus as string)==="active"
    || Boolean(selected?.visitStartedAt&&!selected?.visitFinishedAt)
  );
  const canonicalDone=Boolean(selected?.canonicalVisitId)&&(
    selected?.canonicalVisitStatus==="completed"
    || Boolean(selected?.visitFinishedAt)
  );
  const canonicalMissed=Boolean(selected?.canonicalVisitId)&&selected?.canonicalVisitStatus==="missed";
  const openTasks=tasks.filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew));

  const runningSeconds=useMemo(()=>{
    if(selected?.canonicalVisitId){
      if(selected.visitDurationSeconds)return selected.visitDurationSeconds;
      const started=selected.visitStartedAt?new Date(selected.visitStartedAt).getTime():0;
      const finished=selected.visitFinishedAt?new Date(selected.visitFinishedAt).getTime():0;
      if(started)return Math.max(0,Math.round(((finished||Date.now())-started)/1000));
      return 0;
    }
    if(!session)return 0;
    if(session.durationSeconds)return session.durationSeconds;
    if(session.startedAt&&session.status==="running")return Math.max(0,Math.round((Date.now()-new Date(session.startedAt).getTime())/1000));
    return 0;
  },[session,tick,selected?.canonicalVisitId,selected?.visitDurationSeconds,selected?.visitStartedAt,selected?.visitFinishedAt]);


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

  async function start(){
    if(!selected)return;
    try{
      if(selected.canonicalVisitId){
        const visitId=selected.canonicalVisitId;
        const transition=await runVisitStatusOrQueue(visitId,"in_progress") as {visit?:{status?:string;started_at?:string|null;finished_at?:string|null;duration_seconds?:number|null}};
        const verified=transition.visit;
        if(verified?.status!=="in_progress"||!verified.started_at||verified.finished_at){
          throw new Error("The server did not confirm this Visit as active.");
        }
        const confirmed={
          status:"in_progress",
          startedAt:verified.started_at||undefined,
          finishedAt:undefined,
          durationSeconds:undefined,
        };
        verifiedExecutionRef.current.set(visitId,confirmed);
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          ...confirmed,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"in_progress")
          .then(acceptCanonicalContext)
          .catch(error=>setMenuMessage(error instanceof Error?error.message:"The active Visit could not be refreshed."));
      }else{
        startServiceSession(selected.id,profile.name,crew);
      }
      setCommentOpen(false);setServiceComment("");setDoneMessage("");refresh();
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be started.")}
  }
  function saveComment(){
    if(!selected)return;
    if(!serviceComment.trim()){setMenuMessage("Type a comment before saving.");return;}
    saveServiceComment(selected.id, serviceComment);
    setMenuMessage("Comment saved.");
    setCommentOpen(false);
    refresh();
  }
  async function finish(){
    if(!selected)return;
    if(!window.confirm("Complete this house and mark it as Done?"))return;
    try{
      if(selected.canonicalVisitId){
        const visitId=selected.canonicalVisitId;
        const transition=await runVisitStatusOrQueue(visitId,"completed") as {visit?:{status?:string;started_at?:string|null;finished_at?:string|null;duration_seconds?:number|null}};
        const verified=transition.visit;
        if(verified?.status!=="completed"||!verified.started_at||!verified.finished_at||!Number.isFinite(Number(verified.duration_seconds))){
          throw new Error("The server did not confirm this Visit as completed.");
        }
        const confirmed={
          status:"completed",
          startedAt:verified.started_at||undefined,
          finishedAt:verified.finished_at||undefined,
          durationSeconds:Number(verified.duration_seconds),
        };
        verifiedExecutionRef.current.set(visitId,confirmed);
        setMapContext(current=>({...current,stops:current.stops.map(stop=>stop.visitId===visitId?{
          ...stop,
          ...confirmed,
        }:stop)}));
        void loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,visitId,"completed")
          .then(acceptCanonicalContext)
          .catch(error=>setMenuMessage(error instanceof Error?error.message:"The completed Visit could not be refreshed."));
      }else{
        finishServiceSession(selected.id,serviceComment);
      }
      setDoneMessage("Done");setServiceComment("");setCommentOpen(false);refresh();window.setTimeout(()=>{setDoneMessage("");setView("route")},850);
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be completed.")}
  }
  async function reset(){
    if(!selected)return;
    if(!window.confirm("Reset only this house? Status returns to Open across Admin, Dispatch and Employee Route."))return;
    try{
      if(selected.canonicalVisitId){
        await runVisitStatusOrQueue(selected.canonicalVisitId,"scheduled");
        verifiedExecutionRef.current.delete(selected.canonicalVisitId);
        acceptCanonicalContext(await loadEmployeeRouteMapContextUntilStatus(selectedDate,crew,selected.canonicalVisitId,"scheduled"));
      }else{
        resetServiceSession(selected.id);
      }
      setDoneMessage("Reset to Open");refresh();
    }catch(error){setMenuMessage(error instanceof Error?error.message:"Service could not be reset.")}
  }

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
  const selectedDateLabel=new Date(`${selectedDate}T12:00:00`).toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const todayKey=localDateKey(new Date());
  const dayOptions=useMemo(()=>Array.from({length:7},(_,index)=>{const date=new Date(`${weekStart}T12:00:00`);date.setDate(date.getDate()+index);return{key:localDateKey(date),weekday:date.toLocaleDateString("en-CA",{weekday:"short"}),day:date.getDate(),name:DAMASIO_WEEK_DAYS[index]}}),[weekStart]);
  const weekLabel=`${new Date(`${weekStart}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})} – ${new Date(`${shiftDate(weekStart,6)}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}`;
  function selectRouteDate(value:string,name:string){setSelectedDate(value);setDay(name);setSelectedId("");setView("route")}
  function moveWeek(days:-7|7){const next=shiftDate(weekStart,days);setWeekStart(next);selectRouteDate(next,"Monday")}
  const details=selected?.propertyDetails;
  const workflow=selected?getLeadWorkflowSnapshot(selected):null;
  const unreadIssues=notificationsSeen?0:openTasks.length;
  

  return <div className="field-shell">
    <div className="field-topbar">
      <div className="field-brand-mini"><div className="field-brand-mark">4</div><div>4Ever Seasons Field</div></div>
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

    <section className="employee-route-week employee-week-picker">
      <div><button type="button" aria-label="Previous week" onClick={()=>moveWeek(-7)}>‹</button><strong>{weekLabel}</strong><button type="button" aria-label="Next week" onClick={()=>moveWeek(7)}>›</button></div>
      <nav className="employee-day-strip" aria-label="Route days">{dayOptions.map(item=><button type="button" key={item.key} className={selectedDate===item.key?"active":item.key<todayKey?"past":""} onClick={()=>selectRouteDate(item.key,item.name)}><span>{item.weekday}</span><strong>{item.day}</strong>{item.key===todayKey&&<i>Today</i>}</button>)}</nav>
    </section>

    <div className="employee-route-filter">
      <div><strong>{crew}</strong><span>{selectedDateLabel} · {day} route</span></div>
      <span className="privacy-pill">Private route</span>
      <CompactFilter label="Route filter"><label><input type="radio" checked={routeFilter==="all"} onChange={()=>setRouteFilter("all")}/> All</label><label><input type="radio" checked={routeFilter==="open"} onChange={()=>setRouteFilter("open")}/> Open</label><label><input type="radio" checked={routeFilter==="done"} onChange={()=>setRouteFilter("done")}/> Done</label></CompactFilter>
      <div className="employee-assigned-crew"><small>Assigned crew</small><strong>{crew||"Loading…"}</strong></div>
    </div>

    {view==="tasks"&&<main className="field-container">
      <div className="field-card" style={{padding:24}}>
        <span className="eyebrow">Notifications</span>
        <h1 className="field-title">Service Issues</h1>
        <p className="section-intro">Open the Service Screen first. Start/Finish only happens inside the property screen.</p>
        
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
        <div className="employee-web-map-sidebar-head"><span className="eyebrow">Today&apos;s route</span><strong>{mapRouteLeads.length} visits</strong><small>{completed} completed</small></div>
        <div className="employee-web-map-route-list">
          {mapRouteLeads.map((lead,index)=>{
            const leadSession=getSessionForLead(lead.id);
            const state=lead.canonicalVisitStatus==="missed"||leadSession?.status==="skipped"?"skipped":lead.canonicalVisitStatus==="completed"||lead.status==="completed"?"completed":"pending";
            return <button type="button" key={lead.id} className={`employee-web-map-route-item ${state}`} onClick={()=>openLead(lead)}>
              <span>{index+1}</span><div><strong>{lead.address||"Not mapped"}</strong><small>{lead.service}</small></div><em>{state}</em>
            </button>;
          })}
          {mapRouteLeads.length===0&&<div className="employee-web-map-empty">No visits assigned to this route.</div>}
        </div>
      </aside>
      <EmployeeRouteMap route={mapRouteLeads} routeId={mapContext.routeId||undefined} originPoint={routeOrigin} onOpenVisit={openLead} desktop />
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
        <div className={(canonicalActive||session?.status==="running")?"timer-status running":(canonicalDone||session?.status==="finished")?"timer-status finished":"timer-status"}>{canonicalActive||session?.status==="running"?"IN PROGRESS":canonicalDone||session?.status==="finished"?"DONE":canonicalMissed?"SKIPPED":"NOT STARTED"}</div>
        <div className="timer-big">{formatDuration(runningSeconds)}</div>
        <div className="timer-grid">
          <div className="timer-box"><div className="timer-label">Started</div><div className="timer-value">{formatClock(selected.canonicalVisitId?selected.visitStartedAt:session?.startedAt)}</div></div>
          <div className="timer-box"><div className="timer-label">Finished</div><div className="timer-value">{formatClock(selected.canonicalVisitId?selected.visitFinishedAt:session?.finishedAt)}</div></div>
        </div>
      </div>

      <div className="row" style={{marginBottom:12}}>
        <button className="start-btn" onClick={start} disabled={selected.canonicalVisitId?canonicalActive||canonicalDone||canonicalMissed:session?.status==="running"}>Start</button>
        <button className="btn btn-outline" onClick={()=>setCommentOpen(!commentOpen)}>💬 Comment</button>
        <button className="finish-btn" onClick={finish} disabled={selected.canonicalVisitId?!canonicalActive:!session||session.status==="finished"}>Finish</button>
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
      {view==="details"&&<button className="reset-btn" onClick={reset}>Reset House</button>}
      {view==="details"?<button className="route-btn" onClick={()=>setView("route")}>Back Route</button>:<Link className="route-btn" href="/employee" style={{textAlign:"center"}}>Exit</Link>}
    </div>
  </div>
}
