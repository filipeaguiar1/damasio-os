"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
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
  saveEmployeeProfile,
  applyEmployeeSmartRoute,
  getEmployeeSmartRouteState,
  restoreEmployeeSmartRoute,
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
  const [tab,setTab]=useState<"route"|"service"|"issues"|"task"|"profile">("route");
  const [homeMode,setHomeMode]=useState<"route"|"smart">("route");
  const [smartSelected,setSmartSelected]=useState<string[]>([]);
  const [smartOrigin,setSmartOrigin]=useState<"current"|"last"|"profile"|"manual">("current");
  const [manualOrigin,setManualOrigin]=useState("");
  const [manualOriginPoint,setManualOriginPoint]=useState<{latitude:number;longitude:number;label:string}|null>(null);
  const [smartAlternative,setSmartAlternative]=useState(0);
  const [smartPreview,setSmartPreview]=useState<Lead[]>([]);
  const [smartOriginPoint,setSmartOriginPoint]=useState<{latitude:number;longitude:number;label:string}|null>(null);
  const [smartPreparing,setSmartPreparing]=useState(false);
  const [smartRouteActive,setSmartRouteActive]=useState(false);
  const [selectedTaskId,setSelectedTaskId]=useState("");
  const [routeView,setRouteView]=useState<"list"|"map">("map");
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
  const [profileDraft,setProfileDraft]=useState(profile);
  const [crew,setCrew]=useState(profile.crew||"Crew A");
  const profilePhotoInput=useRef<HTMLInputElement|null>(null);
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
  const route=useMemo(()=>smartRouteActive?localRoute:applyEmployeeRouteMapContext(localRoute,mapContext),[localRoute,mapContext,smartRouteActive]);
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
  const selectedTask=useMemo(()=>tasks.find(task=>task.id===selectedTaskId)||null,[tasks,selectedTaskId]);
  const taskProperty=useMemo(()=>selectedTask?leads.find(lead=>lead.id===selectedTask.leadId)||null:null,[selectedTask,leads]);
  const done=route.filter(l=>l.status==="completed").length;
  const skipped=route.filter(l=>getSessionForLead(l.id)?.status==="skipped").length;
  const progress=route.length?Math.round((done/route.length)*100):0;
  const nextStop=route.find(l=>l.status!=="completed"&&getSessionForLead(l.id)?.status!=="skipped")||route[0]||null;
  const smartCandidates=useMemo(()=>route.filter(lead=>lead.status!=="completed"&&getSessionForLead(lead.id)?.status!=="skipped"),[route,tick]);
  const lastCompleted=useMemo(()=>[...route].reverse().find(lead=>lead.status==="completed")||null,[route]);
  useEffect(()=>{setSmartSelected(current=>current.filter(id=>smartCandidates.some(lead=>lead.id===id)));setSmartRouteActive(Boolean(getEmployeeSmartRouteState(crew,selectedDate)?.active))},[smartCandidates,crew,selectedDate,routeReload]);

  function clearSmartPreview(){setSmartPreview([]);setSmartOriginPoint(null);setSmartAlternative(0)}
  function toggleSmartStop(id:string){setSmartSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);clearSmartPreview()}
  function smartOriginValue(){if(smartOrigin==="last")return lastCompleted?.address||"";if(smartOrigin==="profile")return profileDraft.defaultAddress||"";if(smartOrigin==="manual")return manualOrigin.trim();return "Current location"}
  async function geocodeAddress(address:string){
    const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`,{cache:"no-store"});
    if(!response.ok)throw new Error("Starting address could not be located.");
    return await response.json() as {latitude:number;longitude:number};
  }
  async function resolveSmartOrigin(){
    if(smartOrigin==="current"){
      if(!navigator.geolocation)throw new Error("Location is not available on this device.");
      const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000}));
      return {latitude:position.coords.latitude,longitude:position.coords.longitude,label:"Current location"};
    }
    const address=smartOriginValue();if(!address)throw new Error("Choose a valid starting point.");
    if(smartOrigin==="manual"&&manualOriginPoint&&manualOriginPoint.label===address)return manualOriginPoint;
    const point=await geocodeAddress(address);return {...point,label:address};
  }
  async function ensureCoordinates(lead:Lead){
    if(Number.isFinite(lead.latitude)&&Number.isFinite(lead.longitude))return lead;
    const point=await geocodeAddress(lead.address);return {...lead,...point};
  }
  function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const x=(a.longitude-b.longitude)*Math.cos((a.latitude+b.latitude)*Math.PI/360);const y=a.latitude-b.latitude;return x*x+y*y}
  function buildSmartOrder(located:Lead[],origin:{latitude:number;longitude:number},alternative:number){
    if(alternative%3===1){
      const angle=(lead:Lead)=>Math.atan2(Number(lead.latitude)-origin.latitude,Number(lead.longitude)-origin.longitude);
      return [...located].sort((a,b)=>angle(a)-angle(b)||distance(origin,a as Lead&{latitude:number;longitude:number})-distance(origin,b as Lead&{latitude:number;longitude:number}));
    }
    if(alternative%3===2){
      const farthest=[...located].sort((a,b)=>distance(origin,b as Lead&{latitude:number;longitude:number})-distance(origin,a as Lead&{latitude:number;longitude:number}));
      const remaining=[...farthest];const ordered:Lead[]=[];let cursor=origin;
      if(remaining.length){const first=remaining.shift()!;ordered.push(first);cursor={latitude:Number(first.latitude),longitude:Number(first.longitude)}}
      while(remaining.length){let best=0;for(let index=1;index<remaining.length;index++)if(distance(cursor,remaining[index] as Lead&{latitude:number;longitude:number})<distance(cursor,remaining[best] as Lead&{latitude:number;longitude:number}))best=index;const next=remaining.splice(best,1)[0];ordered.push(next);cursor={latitude:Number(next.latitude),longitude:Number(next.longitude)}}
      return ordered;
    }
    const remaining=[...located];const ordered:Lead[]=[];let cursor=origin;
    while(remaining.length){let best=0;for(let index=1;index<remaining.length;index++)if(distance(cursor,remaining[index] as Lead&{latitude:number;longitude:number})<distance(cursor,remaining[best] as Lead&{latitude:number;longitude:number}))best=index;const next=remaining.splice(best,1)[0];ordered.push(next);cursor={latitude:Number(next.latitude),longitude:Number(next.longitude)}}
    return ordered;
  }
  async function prepareSmartRoute(nextAlternative=0){
    const chosen=smartCandidates.filter(lead=>smartSelected.includes(lead.id));
    if(!chosen.length){setError("Select at least one pending house.");return}
    setSmartPreparing(true);setError("");setMessage("");
    try{
      const origin=await resolveSmartOrigin();
      const located=await Promise.all(chosen.map(ensureCoordinates));
      const ordered=buildSmartOrder(located,origin,nextAlternative);
      setSmartAlternative(nextAlternative);setSmartOriginPoint(origin);setSmartPreview(ordered);setMessage(nextAlternative?"Another route is ready. Review it before applying.":"Preview ready. Review the map before applying this route.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Smart Route could not be prepared.")}finally{setSmartPreparing(false)}
  }
  function tryAnotherSmartRoute(){void prepareSmartRoute(smartAlternative+1)}
  function applySmartPreview(){
    if(!smartPreview.length||!smartOriginPoint)return;
    const locked=route.filter(lead=>lead.status==="completed"||getSessionForLead(lead.id)?.status==="skipped").map(lead=>lead.id);
    const optimized=smartPreview.map(lead=>lead.id);
    const unselected=route.filter(lead=>!locked.includes(lead.id)&&!optimized.includes(lead.id)).map(lead=>lead.id);
    applyEmployeeSmartRoute(crew,selectedDate,route.map(lead=>lead.id),[...locked,...optimized,...unselected],smartOriginPoint.label);
    setSmartRouteActive(true);setSmartPreview([]);setRouteReload(value=>value+1);refresh();setHomeMode("route");setRouteView("map");setMessage("Smart Route applied. Your map and stop order are updated.");
  }
  function restoreOriginalRoute(){
    if(!window.confirm("Restore the original route assigned by Admin? Completed visits will stay completed."))return;
    if(restoreEmployeeSmartRoute(crew,selectedDate)){setSmartRouteActive(false);setSmartPreview([]);setRouteReload(value=>value+1);refresh();setMessage("Original route restored.")}
  }

  function openService(lead:Lead){setSelectedId(lead.id); setComment(getSessionForLead(lead.id)?.completionComment||""); setContractOpen(true); setTab("service"); setMessage("")}
  function openTask(taskId:string){setSelectedTaskId(taskId);setTab("task");setMessage("")}
  function saveProfile(){const next={...profileDraft,photoLabel:(profileDraft.name||"E").slice(0,1).toUpperCase()};saveEmployeeProfile(next);setProfileDraft(next);setMessage("Profile saved.")}
  function uploadProfilePhoto(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>setProfileDraft(current=>({...current,photoUrl:String(reader.result||"")}));reader.readAsDataURL(file);e.target.value=""}
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
      <button type="button" className="employee-top-back" onClick={()=>{if(tab==="service")setTab("route");else if(tab==="task")setTab("issues");else if(tab==="profile")setTab("route");else window.history.back()}} aria-label="Go back">‹</button>
      <div className="employee-mobile-brand"><span>D</span><div><strong>Employee</strong><small>{profile.name || "Field user"} · {crew}</small></div></div>
      <button type="button" className="mobile-avatar employee-profile-trigger" onClick={()=>{setProfileDraft(getEmployeeProfile());setTab("profile")}} aria-label="Open employee profile">{profile.photoUrl?<img src={profile.photoUrl} alt="Employee profile"/>:(profile.photoLabel||profile.name||"E").slice(0,1)}</button>
    </header>

    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}

    {(tab==="route"||tab==="issues")&&<nav className="employee-home-switch" aria-label="Employee workspace"><button className={homeMode==="route"?"active":""} onClick={()=>{setHomeMode("route");setTab("route")}}><i>⌂</i><span><strong>Routes</strong><small>Today and visits</small></span></button><button className={homeMode==="smart"?"active":""} onClick={()=>{setHomeMode("smart");setTab("route")}}><i>↗</i><span><strong>Smart Route</strong><small>Replan pending stops</small></span></button></nav>}

    {homeMode==="route"&&<section className="employee-week-picker">
      <div><button type="button" aria-label="Previous week" onClick={()=>moveWeek(-7)}>‹</button><strong>{weekLabel}</strong><button type="button" aria-label="Next week" onClick={()=>moveWeek(7)}>›</button></div>
      <nav className="employee-day-strip" aria-label="Route days">
        {dayOptions.map(item=><button key={item.key} className={selectedDate===item.key?"active":item.key<todayKey?"past":""} onClick={()=>{setSelectedDate(item.key);setSelectedId("");setTab("route")}}><span>{item.weekday}</span><strong>{item.day}</strong>{item.key===todayKey&&<i>Today</i>}</button>)}
      </nav>
    </section>}

    {homeMode==="route"&&<section className="employee-mobile-progress">
      <div><strong>{selectedDate===todayKey?"Today’s Route":new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}</strong><span>{done} / {route.length} completed</span></div>
      <div className="employee-progress-track"><i style={{width:`${progress}%`}}/></div>
      <small>{route.length-done-skipped} remaining · {skipped} skipped · {tasks.length} issues</small>
    </section>}

    {homeMode==="route"&&<nav className="mobile-tabs mobile-tabs-two">
      <button className={tab==="route"||tab==="service"?"active":""} onClick={()=>setTab("route")}>Today&apos;s Route</button>
      <button className={tab==="issues"||tab==="task"?"active":""} onClick={()=>setTab("issues")}>Tasks {tasks.length>0&&<b>{tasks.length}</b>}</button>
    </nav>}

    {tab==="route"&&homeMode==="route"&&<>
      <div className="employee-route-tools"><div className="employee-route-view-toggle" role="tablist" aria-label="Route view">
        <button type="button" className={routeView==="list"?"active":""} onClick={()=>setRouteView("list")}>List</button>
        <button type="button" className={routeView==="map"?"active":""} onClick={()=>setRouteView("map")}>Map</button>
      </div>{smartRouteActive&&<button type="button" className="employee-route-restore" onClick={restoreOriginalRoute} aria-label="Restore original route">↶<span>Original</span></button>}</div>
      {routeView==="list"?<section className="mobile-card-list">
        {route.map((lead,index)=><button className={`mobile-route-card employee-video-route-card ${lead.status==="completed"?"completed":""}`} key={lead.id} onClick={()=>openService(lead)}>
          <span className="mobile-route-index">{index+1}</span>
          <div><strong>{lead.address}</strong><p>{lead.name}</p><em>{lead.service} · {lead.serviceFrequency||"weekly"}</em></div>
          <b className={lead.status==="completed"?"mobile-status done":getSessionForLead(lead.id)?.status==="skipped"?"mobile-status skipped":"mobile-status"}>{statusLabel(lead,getSessionForLead(lead.id))}</b>
        </button>)}
      </section>:<EmployeeRouteMap route={mapRoute} routeId={smartRouteActive?undefined:(mapContext.routeId||undefined)} onOpenVisit={openService}/>}
      {routeView==="list"&&nextStop&&<a className="employee-next-directions" href={mapsHref(nextStop.address)} target="_blank" rel="noopener noreferrer"><span>Get directions to next</span><b>⌖</b></a>}
    </>}


    {tab==="route"&&homeMode==="smart"&&<section className="employee-smart-route">
      <header><div><small>SMART ROUTE · {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-CA",{weekday:"long",month:"short",day:"numeric"})}</small><h1>Replan pending houses</h1><p>Preview the suggested order on our map. Nothing changes until you approve it.</p></div><i>↗</i></header>
      <div className="employee-smart-origin"><strong>Starting point</strong><div>{[["current","Current location"],["last","Last completed house"],["profile","Profile address"],["manual","Manual address"]].map(([value,label])=><button key={value} className={smartOrigin===value?"active":""} onClick={()=>{setSmartOrigin(value as typeof smartOrigin);setManualOriginPoint(null);clearSmartPreview()}}>{label}</button>)}</div>{smartOrigin==="manual"&&<AddressAutocomplete value={manualOrigin} onChange={value=>{setManualOrigin(value);setManualOriginPoint(null);clearSmartPreview()}} onSelect={suggestion=>{setManualOrigin(suggestion.label);setManualOriginPoint({latitude:suggestion.latitude,longitude:suggestion.longitude,label:suggestion.label});clearSmartPreview()}} placeholder="Start typing the route address" ariaLabel="Manual route start"/>}{smartOrigin==="profile"&&<p>{profileDraft.defaultAddress||"Add a default route address in your profile."}</p>}{smartOrigin==="last"&&<p>{lastCompleted?.address||"No completed house is available yet."}</p>}{smartOrigin==="current"&&<p>Uses the employee phone GPS after permission is granted.</p>}</div>
      <div className="employee-smart-head"><span>{smartSelected.length} selected · {smartCandidates.length} pending</span><button onClick={()=>{setSmartSelected(smartSelected.length===smartCandidates.length?[]:smartCandidates.map(lead=>lead.id));setSmartPreview([])}}>{smartSelected.length===smartCandidates.length?"Clear":"Select all pending"}</button></div>
      <div className="employee-smart-list">{route.map((lead,index)=>{const completed=lead.status==="completed";const skippedState=getSessionForLead(lead.id)?.status==="skipped";const disabled=completed||skippedState;const selectedStop=smartSelected.includes(lead.id);return <button key={lead.id} disabled={disabled} className={`${selectedStop?"selected":""} ${disabled?"locked":""}`} onClick={()=>toggleSmartStop(lead.id)}><b>{disabled?"✓":selectedStop?"✓":index+1}</b><div><strong>{lead.address}</strong><span>{lead.name} · {lead.service}</span><small>{completed?"Completed — locked":skippedState?"Skipped — excluded":"Pending and available"}</small></div><i>{disabled?"Locked":selectedStop?"Included":"Add"}</i></button>})}</div>
      {!smartPreview.length?<button className="employee-smart-build" disabled={!smartSelected.length||smartPreparing} onClick={()=>void prepareSmartRoute(0)}>{smartPreparing?"Preparing preview…":"Preview Smart Route"}<span>↗</span></button>:<section className="employee-smart-preview"><header><div><small>ROUTE PREVIEW</small><strong>{smartPreview.length} pending stops</strong><span>Start: {smartOriginPoint?.label}</span></div><button onClick={clearSmartPreview}>Edit</button></header><div className="employee-smart-map-wrap"><EmployeeRouteMap route={smartPreview} originPoint={smartOriginPoint} onOpenVisit={()=>{}} actionLabel="Preview stop"/><button type="button" className="employee-smart-alternate" disabled={smartPreparing} onClick={tryAnotherSmartRoute} aria-label="Try another route" title="Try another route">{smartPreparing?"…":"↻"}</button></div><div className="employee-smart-preview-actions"><button onClick={clearSmartPreview}>Cancel</button><button onClick={applySmartPreview}>Apply Smart Route</button></div></section>}
      {message&&<p className="mobile-message">{message}</p>}
    </section>}

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

    {tab==="issues"&&<section className="mobile-card-list employee-task-list">
      {tasks.length===0?<div className="mobile-empty"><strong>No return visits.</strong><p>Assigned Tasks will appear here.</p></div>:tasks.map(task=><button className={`mobile-issue-card employee-task-card ${task.priority}`} key={task.id} onClick={()=>openTask(task.id)}>
        <span className="employee-task-icon">!</span><div><em>RETURN TASK · {task.priority}</em><strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>{task.description}</small></div><b>›</b>
      </button>)}
    </section>}

    {tab==="task"&&selectedTask&&<section className="mobile-service-screen mobile-browser-service mobile-property-reference employee-task-detail">
      <button className="mobile-inline-back" onClick={()=>setTab("issues")}>← Tasks</button>
      <div className="employee-task-banner"><span>!</span><div><small>RETURN TASK</small><strong>{selectedTask.priority==="urgent"?"Urgent follow-up":"Follow-up required"}</strong></div><b>{selectedTask.status.replace("_"," ")}</b></div>
      <div className="mobile-service-head"><div><h1>{selectedTask.address}</h1><p>{selectedTask.customer}</p></div></div>
      <article className="property-contract-summary employee-task-property"><div className="property-contract-thumb">{taskProperty?.propertyPhoto?<img src={taskProperty.propertyPhoto} alt="Property"/>:<span>🏡</span>}</div><div><strong>{taskProperty?.service||"Property follow-up"}</strong><small>{taskProperty?.serviceFrequency||"Return visit"} · {selectedTask.scheduledDate||"Assigned"}</small></div><i>ⓘ</i></article>
      {taskProperty&&<article className="property-compact-card mobile-property-data-card employee-task-property-data"><dl><div><dt>Primary service</dt><dd>{taskProperty.service}</dd></div><div><dt>Frequency</dt><dd>{taskProperty.serviceFrequency||"One time"}</dd></div><div><dt>Customer since</dt><dd>{new Date(taskProperty.createdAt).toLocaleDateString("en-CA",{month:"short",year:"numeric"})}</dd></div><div><dt>Lot size</dt><dd>{taskProperty.propertyDetails?.lawnSize?.toUpperCase()||"Not set"}</dd></div><div><dt>Cut height</dt><dd>{taskProperty.propertyDetails?.grassHeight||"Not set"}</dd></div><div><dt>Grass handling</dt><dd>{handlingLabel(taskProperty.propertyDetails?.grassHandling)}</dd></div><div><dt>Backyard / gate</dt><dd>{taskProperty.propertyDetails?.backyard?"Backyard":"No backyard"} · {taskProperty.propertyDetails?.gated?"Gated":"Open"}</dd></div><div><dt>Phone</dt><dd>{taskProperty.phone||"Not available"}</dd></div><div><dt>Email</dt><dd>{taskProperty.email||"Not available"}</dd></div></dl></article>}
      <article className="employee-task-request"><small>WHAT NEEDS TO BE FIXED</small><h2>{selectedTask.title}</h2><p>{selectedTask.description}</p></article>
      {taskProperty&&(taskProperty.propertyDetails?.accessNotes||taskProperty.propertyDetails?.propertyAlerts||taskProperty.notes)&&<div className="property-access-banner">ⓘ {taskProperty.propertyDetails?.accessNotes||taskProperty.propertyDetails?.propertyAlerts||taskProperty.notes}</div>}
      <a className="employee-task-directions" href={mapsHref(selectedTask.address)} target="_blank" rel="noopener noreferrer"><span>Directions to property</span><b>⌖</b></a>
      {taskProperty&&<div className="employee-contact-actions">{taskProperty.phone&&<a href={`tel:${taskProperty.phone}`}>Call client</a>}{taskProperty.email&&<a href={`mailto:${taskProperty.email}`}>Email client</a>}</div>}
      <section className="employee-image-section"><strong>Property and customer images</strong><div>{[taskProperty?.propertyPhoto,...(taskProperty?.photos||[])].filter(Boolean).map((photo,index)=><img key={index} src={photo} alt={`Task reference ${index+1}`}/>)}{!taskProperty?.propertyPhoto&&!(taskProperty?.photos?.length)&&<span className="mobile-property-no-images">No customer images attached</span>}</div></section>
      <div className="mobile-action-grid employee-task-actions"><button className="mobile-primary" disabled={busy||selectedTask.status==="in_progress"} onClick={()=>{updateEmployeeTaskStatus(selectedTask.id,"in_progress");setMessage("Task started.");refresh()}}>Start Task</button><button className="mobile-finish" disabled={busy||selectedTask.status!=="in_progress"} onClick={()=>{if(window.confirm("Mark this return Task as completed and send it to Admin review?")){updateEmployeeTaskStatus(selectedTask.id,"completed","Return Task completed from Employee mobile app",profile.name);setTab("issues");refresh()}}}>Complete Task</button></div>
      {message&&<p className="mobile-message">{message}</p>}
    </section>}

    {tab==="profile"&&<section className="mobile-service-screen mobile-browser-service employee-profile-screen">
      <button className="mobile-inline-back" onClick={()=>setTab("route")}>← Back</button>
      <header><button className="employee-profile-photo" onClick={()=>profilePhotoInput.current?.click()}>{profileDraft.photoUrl?<img src={profileDraft.photoUrl} alt="Employee"/>:<span>{(profileDraft.name||"E").slice(0,1)}</span>}<small>Change photo</small></button><div><small>EMPLOYEE PROFILE</small><h1>{profileDraft.name||"Employee"}</h1><p>{crew}</p></div></header>
      <input ref={profilePhotoInput} type="file" accept="image/*" hidden onChange={uploadProfilePhoto}/>
      <div className="employee-profile-form"><label><span>Name</span><input value={profileDraft.name} onChange={e=>setProfileDraft(current=>({...current,name:e.target.value}))}/></label><label><span>Phone</span><input type="tel" value={profileDraft.phone||""} onChange={e=>setProfileDraft(current=>({...current,phone:e.target.value}))}/></label><label><span>Email</span><input type="email" value={profileDraft.email} onChange={e=>setProfileDraft(current=>({...current,email:e.target.value}))}/></label><label><span>Default route address</span><textarea value={profileDraft.defaultAddress||""} onChange={e=>setProfileDraft(current=>({...current,defaultAddress:e.target.value}))} placeholder="Used by Admin as an optional route starting point"/></label></div>
      <button className="mobile-primary employee-profile-save" onClick={saveProfile}>Save Profile</button>{message&&<p className="mobile-message">{message}</p>}<button className="employee-profile-signout" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
    </section>}
  </main></MobileRoleGuard>
}
