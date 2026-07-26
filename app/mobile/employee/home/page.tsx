"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { PremiumMobileHeader, PremiumMobileNav } from "@/components/mobile/PremiumMobileChrome";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Stop = {
  visitId: string;
  jobId: string | null;
  customerId: string | null;
  propertyId: string | null;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  routeOrder: number | null;
  status: string;
  customerName: string;
  serviceName: string;
  scheduledDate: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  employeeNotes: string | null;
};

type RoutePayload = {
  employee: { id: string; profileId: string | null; companyId: string; name: string; crewId: string | null; email: string | null; avatarUrl: string | null };
  routeId: string | null;
  stops: Stop[];
};

function todayKey(){const date=new Date();const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,"0");const day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`}
function formatDuration(seconds:number){const safe=Math.max(0,Math.floor(seconds));const h=String(Math.floor(safe/3600)).padStart(2,"0");const m=String(Math.floor((safe%3600)/60).padStart(2,"0"));const s=String(safe%60).padStart(2,"0");return `${h}:${m}:${s}`}
function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}

export default function PremiumEmployeeHome(){
  const [payload,setPayload]=useState<RoutePayload>({employee:{id:"",profileId:null,companyId:"",name:"Employee",crewId:null,email:null,avatarUrl:null},routeId:null,stops:[]});
  const [selectedId,setSelectedId]=useState("");
  const [note,setNote]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [tick,setTick]=useState(0);

  const getToken=useCallback(async()=>{
    const{data}=await getSupabaseBrowserClient().auth.getSession();
    const token=data.session?.access_token;
    if(!token)throw new Error("Your Employee login expired. Sign in again.");
    return token;
  },[]);

  const refresh=useCallback(async()=>{
    try{
      const token=await getToken();
      const response=await fetch(`/api/mobile/employee/route?date=${todayKey()}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Today's route could not be loaded.");
      setPayload(result as RoutePayload);
      setSelectedId(current=>current&&(result.stops||[]).some((stop:Stop)=>stop.visitId===current)?current:(result.stops||[]).find((stop:Stop)=>stop.status!=="completed")?.visitId||(result.stops||[])[0]?.visitId||"");
      setError("");
    }catch(nextError){setError(nextError instanceof Error?nextError.message:"Today's route could not be loaded.")}
    finally{setLoading(false)}
  },[getToken]);

  useEffect(()=>{void refresh();const reload=window.setInterval(()=>void refresh(),20000);const timer=window.setInterval(()=>setTick(value=>value+1),1000);return()=>{window.clearInterval(reload);window.clearInterval(timer)}},[refresh]);

  const ordered=useMemo(()=>[...payload.stops].sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.addressLine1.localeCompare(b.addressLine1)),[payload.stops]);
  const selected=ordered.find(stop=>stop.visitId===selectedId)||ordered[0]||null;
  const selectedIndex=selected?ordered.findIndex(stop=>stop.visitId===selected.visitId):0;
  const upcoming=selected?ordered.filter(stop=>stop.visitId!==selected.visitId&&stop.status!=="completed").slice(0,2):ordered.slice(0,2);
  const completed=ordered.filter(stop=>stop.status==="completed").length;
  const inProgress=ordered.filter(stop=>stop.status==="in_progress").length;
  const startedMs=selected?.startedAt?new Date(selected.startedAt).getTime():0;
  const finishedMs=selected?.finishedAt?new Date(selected.finishedAt).getTime():0;
  const elapsed=selected?.durationSeconds??(startedMs?Math.max(0,Math.round(((finishedMs||Date.now())-startedMs)/1000)):0);
  void tick;

  useEffect(()=>{setNote(selected?.employeeNotes||"")},[selected?.visitId,selected?.employeeNotes]);

  async function updateVisit(action:"start"|"done"|"note"){
    if(!selected)return;
    setBusy(true);setError("");setMessage("");
    try{
      const token=await getToken();
      const response=await fetch("/api/mobile/employee/route",{method:"PATCH",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({visitId:selected.visitId,action,note})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"The visit could not be updated.");
      setMessage(action==="start"?"Visit started.":action==="done"?"Visit completed.":"Note saved.");
      await refresh();
    }catch(nextError){setError(nextError instanceof Error?nextError.message:"The visit could not be updated.")}
    finally{setBusy(false)}
  }

  const nav=[
    {id:"home",href:"/mobile/employee/home",icon:"⌂",label:"Home"},
    {id:"route",href:"/mobile/employee",icon:"▣",label:"Route"},
    {id:"tasks",href:"/mobile/employee",icon:"☑",label:"Tasks"},
    {id:"visits",href:"/mobile/employee",icon:"♙",label:"Visits"},
    {id:"more",href:"/mobile/employee",icon:"⋮",label:"More"},
  ];

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="premium-mobile-page premium-employee-page">
      <PremiumMobileHeader role="EMPLOYEE" name={payload.employee.name||"Employee"} subtitle="Employee" menuHref="/mobile/employee" notificationHref="/mobile/employee" avatarUrl={payload.employee.avatarUrl} rightLabel={payload.employee.crewId?"My Crew":"Today's Route"}/>
      <section className="premium-mobile-content">
        {error&&<p className="mobile-message mobile-error">{error}</p>}
        {message&&<p className="mobile-message">{message}</p>}

        <section className="premium-panel premium-employee-route-card">
          <div className="premium-employee-route-copy">
            <small>TODAY&apos;S ROUTE</small>
            {selected?<>
              <div className="premium-employee-stop-title"><b>{selectedIndex+1}</b><div><span>STOP {selectedIndex+1} OF {ordered.length}</span><h1>{selected.customerName}</h1></div>{selected.status==="in_progress"&&<em>In Progress</em>}</div>
              <p>⌖ {selected.addressLine1}{selected.city?`, ${selected.city}`:""}{selected.province?`, ${selected.province}`:""}</p>
              <p>▣ Scheduled Service<br/><strong>Today · {selected.serviceName}</strong></p>
            </>:<><h1>{loading?"Loading today's route…":"No route assigned"}</h1><p>When Admin assigns a visit to this Employee or crew, it appears here automatically.</p></>}
          </div>
          <div className="premium-route-map-art premium-employee-route-map" aria-hidden="true"><span className="premium-route-line"/><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b>{selected&&<a href={mapsHref(selected.addressLine1)} target="_blank" rel="noopener noreferrer">View Full Route →</a>}</div>
        </section>

        <section className="premium-employee-live-job">
          <div className="premium-employee-job-main"><small>LIVE JOB</small><div><i>♧</i><span><strong>{selected?.serviceName||"Property Service"}</strong><b>{selected?.customerName||"No active customer"}</b></span></div></div>
          <div className="premium-employee-timer"><span>TIMER</span><strong>{formatDuration(elapsed)}</strong><small className={selected?.status==="in_progress"?"running":""}>{selected?.status==="in_progress"?"● In Progress":selected?.status==="completed"?"✓ Completed":"Ready to start"}</small></div>
          <div className="premium-employee-job-actions"><button disabled={busy||!selected||selected.status==="in_progress"||selected.status==="completed"} onClick={()=>void updateVisit("start")}>▶ Start</button><Link href="/mobile/employee">▣ Open Visit</Link><button disabled={busy||!selected||selected.status==="completed"} onClick={()=>void updateVisit("done")}>✓ Done</button></div>
        </section>

        <div className="premium-two-column premium-employee-work-grid">
          <section className="premium-panel premium-proof-panel"><div className="premium-panel-head"><div><small>PROOF OF WORK</small><h2>Visit photos</h2></div><Link href="/mobile/employee">Add photos</Link></div><div className="premium-proof-grid"><Link href="/mobile/employee"><span>Before Photo</span><div>♧<b>◉</b></div></Link><Link href="/mobile/employee"><span>After Photo</span><div>♧<b>◉</b></div></Link></div></section>
          <section className="premium-panel premium-notes-panel"><div className="premium-panel-head"><div><small>NOTES / COMMENTS</small><h2>Employee note</h2></div></div><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Add a note for Admin and the visit history."/><button disabled={busy||!selected} onClick={()=>void updateVisit("note")}>✎ Save Note</button></section>
        </div>

        <section className="premium-panel"><div className="premium-panel-head"><div><small>UP NEXT</small><h2>Remaining stops</h2></div><Link href="/mobile/employee">Full route</Link></div><div className="premium-list">{upcoming.length?upcoming.map(stop=><button className="premium-list-row premium-next-stop" key={stop.visitId} onClick={()=>setSelectedId(stop.visitId)}><i>{ordered.findIndex(item=>item.visitId===stop.visitId)+1}</i><div><strong>{stop.customerName}</strong><span>{stop.addressLine1}</span></div><b>{stop.serviceName}</b></button>):<div className="premium-list-row"><i>✓</i><div><strong>Route complete</strong><span>No additional stop is waiting.</span></div><b>Done</b></div>}</div></section>

        <section className="premium-employee-stats"><div><i>◷</i><span>Stops Today</span><strong>{ordered.length}</strong></div><div><i>✓</i><span>Completed</span><strong>{completed}</strong></div><div><i>◌</i><span>In Progress</span><strong>{inProgress}</strong></div><div><i>◷</i><span>Remaining</span><strong>{Math.max(0,ordered.length-completed)}</strong></div></section>
      </section>
      <PremiumMobileNav items={nav} active="home"/>
    </main>
  </MobileRoleGuard>;
}
