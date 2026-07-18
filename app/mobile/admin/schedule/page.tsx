"use client";

import {useEffect,useMemo,useState} from "react";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";
import {MobileAdminNav} from "@/components/mobile/MobileAdminNav";
import {DAMASIO_SYNC_EVENT,getLeads,type Lead} from "@/lib/storage";

function visitDate(lead:Lead){return lead.scheduledDate||lead.nextVisitDate||"Unscheduled"}
function niceDate(value:string){return value==="Unscheduled"?value:new Date(`${value}T12:00:00`).toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric"})}

export default function MobileAdminSchedule(){
  const[tick,setTick]=useState(0);
  const[selected,setSelected]=useState<Lead|null>(null);
  const[openWorkers,setOpenWorkers]=useState<string[]>([]);

  useEffect(()=>{const on=()=>setTick(v=>v+1);window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);

  const groups=useMemo(()=>{
    tick;
    const rows=getLeads().filter(lead=>lead.scheduledDate||lead.nextVisitDate);
    return Object.entries(rows.reduce<Record<string,Lead[]>>((all,lead)=>{const worker=lead.assignedCrew||"Unassigned";(all[worker]??=[]).push(lead);return all},{}))
      .map(([worker,visits])=>[worker,visits.sort((a,b)=>visitDate(a).localeCompare(visitDate(b))||a.address.localeCompare(b.address))] as const)
      .sort(([a],[b])=>a==="Unassigned"?1:b==="Unassigned"?-1:a.localeCompare(b));
  },[tick]);

  useEffect(()=>{setOpenWorkers(current=>current.length?current:groups[0]?[groups[0][0]]:[])},[groups]);
  function toggle(worker:string){setOpenWorkers(current=>current.includes(worker)?current.filter(value=>value!==worker):[...current,worker])}

  return <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell role-mobile-shell mobile-native-subpage">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin"/><div><strong>Schedule</strong><span>Calendar and planned visits</span></div><span className="role-mobile-avatar">□</span></header>
    <section className="mobile-native-hero"><span>PLANNED WORK</span><h1>Visits organized by worker.</h1><p>Open a worker to see assigned houses, completed work and remaining visits.</p></section>
    <section className="mobile-schedule-workers">{groups.map(([worker,rows])=>{const open=openWorkers.includes(worker);const done=rows.filter(row=>row.status==="completed").length;const remaining=rows.length-done;return <section className={open?"open":""} key={worker}>
      <button type="button" className="mobile-schedule-worker-head" onClick={()=>toggle(worker)} aria-expanded={open}><span className="mobile-schedule-worker-avatar">{worker==="Unassigned"?"!":worker.slice(0,1).toUpperCase()}</span><div><strong>{worker}</strong><small>{rows.length} houses · {done} done · {remaining} remaining</small></div><span className="mobile-schedule-progress"><i style={{width:`${rows.length?Math.round(done/rows.length*100):0}%`}}/></span><b>{open?"⌃":"⌄"}</b></button>
      {open&&<div className="mobile-schedule-worker-list">{rows.map(lead=><button type="button" onClick={()=>setSelected(lead)} key={lead.id}><i className="mobile-schedule-thumb">{lead.propertyPhoto?<img src={lead.propertyPhoto} alt=""/>:"□"}</i><div><small>{niceDate(visitDate(lead))}</small><strong>{lead.name}</strong><span>{lead.address}</span><em>{lead.service}</em></div><b className={lead.status==="completed"?"done":""}>{lead.status==="completed"?"✓":"›"}</b></button>)}</div>}
    </section>})}{!groups.length&&<div className="mobile-native-empty"><i>□</i><strong>No scheduled visits</strong><p>Planned houses will appear here by worker.</p></div>}</section>
    {selected&&<ScheduleSheet lead={selected} close={()=>setSelected(null)}/>}<MobileAdminNav active="home"/>
  </main></MobileRoleGuard>
}

function ScheduleSheet({lead,close}:{lead:Lead;close:()=>void}){const d=lead.propertyDetails;return <div className="mobile-native-modal mobile-detail-sheet"><button className="mobile-native-scrim" onClick={close}/><section><header><div><span>SCHEDULED PROPERTY</span><h2>{lead.name}</h2></div><button onClick={close}>×</button></header><div className="mobile-sheet-property-photo">{lead.propertyPhoto?<img src={lead.propertyPhoto} alt={`Profile of ${lead.address}`}/>:<span>⌂<small>No profile photo</small></span>}</div><dl className="mobile-property-dl"><div><dt>Address</dt><dd>{lead.address}</dd></div><div><dt>Visit</dt><dd>{lead.scheduledDate||lead.nextVisitDate}</dd></div><div><dt>Service</dt><dd>{lead.service} · {lead.serviceFrequency||"One time"}</dd></div><div><dt>Value</dt><dd>${lead.total.toFixed(2)}</dd></div><div><dt>Crew</dt><dd>{lead.assignedCrew||"Unassigned"}</dd></div><div><dt>Lawn</dt><dd>{d?.lawnSize||"Not set"} · {d?.grassHeight||"Not set"}</dd></div><div><dt>Access</dt><dd>{d?.gated?"Gated":"Open"} · {d?.backyard?"Backyard":"No backyard"}</dd></div><div><dt>Instructions</dt><dd>{d?.accessNotes||d?.propertyAlerts||lead.notes||"No special instructions"}</dd></div><div><dt>Contact</dt><dd>{lead.phone||"No phone"} · {lead.email||"No email"}</dd></div></dl><a className="mobile-native-submit" href={`/mobile/admin/customers?property=${lead.id}`}>Open complete customer record</a></section></div>}
