"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { DAMASIO_CREWS, Lead, dayNameFromDate, isLeadAvailableForRoute } from "@/lib/storage";
import { assignJobToRoute, changeVisitStatus, loadSchedulingDispatchBoard, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { DispatchCrew } from "@/lib/repositories/schedulingRepository";

export default function Schedule(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [date,setDate]=useState("");
  const [serviceWindow,setServiceWindow]=useState("Morning");
  const [crew,setCrew]=useState(DAMASIO_CREWS[0]);
  const [selected,setSelected]=useState<string[]>([]);
  const [message,setMessage]=useState("Choose houses, date and crew, then create the route.");
  const [filter,setFilter]=useState("all");
  const [city,setCity]=useState("all");
  const [crews,setCrews]=useState<DispatchCrew[]>([]);
  const [busy,setBusy]=useState(false);

  async function refresh(){try{const board=await loadSchedulingDispatchBoard({force:true});setLeads(schedulingBoardToLeads(board));setCrews(board.crews)}catch(error){setMessage(error instanceof Error?error.message:"Database route could not be loaded.")}}
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer)},[]);

  const routeDay=date?dayNameFromDate(date):"Select date";
  const today=new Date().toISOString().slice(0,10);
  const cities=useMemo(()=>[...new Set(leads.map(l=>l.address.split(",").pop()?.trim()||"Other"))].sort(),[leads]);
  const visible=useMemo(()=>[...leads].filter(l=>{
    const inferredCity=l.address.split(",").pop()?.trim()||"Other";
    if(city!=="all"&&inferredCity!==city)return false;
    if(filter==="ready")return isLeadAvailableForRoute(l);
    if(filter==="no-date")return l.status!=="completed"&&!l.scheduledDate&&!l.nextVisitDate;
    if(filter==="assigned")return !isLeadAvailableForRoute(l)&&l.status!=="completed";
    if(filter==="pending-today")return l.status!=="completed"&&(l.scheduledDate===today||l.nextVisitDate===today);
    if(filter==="overdue"){const next=l.nextVisitDate||l.scheduledDate;return l.status!=="completed"&&Boolean(next&&next<today);}
    if(filter==="done")return l.status==="completed";
    if(filter==="crew")return l.assignedCrew===crew;
    return true;
  }).sort((a,b)=>(a.nextVisitDate||a.scheduledDate||"").localeCompare(b.nextVisitDate||b.scheduledDate||"")||a.address.localeCompare(b.address)),[leads,filter,crew,city,today]);
  const available=visible.filter(isLeadAvailableForRoute);
  const assigned=visible.filter(l=>!isLeadAvailableForRoute(l));
  const scheduledForDate=visible.filter(l=>date&&l.scheduledDate===date);
  const allSelected=available.length>0&&available.every(l=>selected.includes(l.id));

  function toggle(id:string){setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
  function selectUnscheduled(){setSelected(available.map(l=>l.id));setMessage(`${available.length} available house(s) selected.`)}
  function selectDateRoute(){setSelected(scheduledForDate.map(l=>l.id));setMessage(`${scheduledForDate.length} house(s) already on ${routeDay} selected.`)}
  function toggleAll(){setSelected(allSelected?[]:available.map(l=>l.id))}

  async function assignOne(id:string){
    if(!date){setMessage("Select a service date first.");return;}
    const crewId=crews.find(item=>item.name===crew)?.id;if(!crewId){setMessage("Choose a valid crew.");return}
    setBusy(true);try{await assignJobToRoute({jobId:id,crewId,routeDate:date});setMessage("House published to Supabase. Every Employee device will receive it.");await refresh()}catch(error){setMessage(error instanceof Error?error.message:"House could not be assigned.")}finally{setBusy(false)}
  }

  async function createRoute(){
    if(!date){setMessage("Select a service date first.");return;}
    if(selected.length===0){setMessage("Select at least one house to create a route.");return;}
    const crewId=crews.find(item=>item.name===crew)?.id;if(!crewId){setMessage("Choose a valid crew.");return}
    setBusy(true);try{for(let index=0;index<selected.length;index++)await assignJobToRoute({jobId:selected[index],crewId,routeDate:date,routeOrder:index+1});setMessage(`${selected.length} house(s) published to ${crew}. The sequence is shared by every device.`);setSelected([]);await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Route could not be published.")}finally{setBusy(false)}
  }

  async function resetVisit(id:string,name:string){if(!window.confirm(`Reset ${name} assignment? This removes it from the published route and returns the job to Available.`))return;setBusy(true);try{await changeVisitStatus(id,"cancelled");setMessage(`${name} was removed from the Supabase route.`);await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Assignment could not be reset.")}finally{setBusy(false)}}

  return <AdminShell active="Dispatch">
    <div className="app-top">
      <div><span className="eyebrow">V42.8.1 Simple Dispatch</span><h1>Schedule & Dispatch</h1><p className="section-intro">This is the operational dispatch screen: select 1, 10 or 20 houses, choose date and crew, then create the employee route. Unfinished houses stay pending/overdue until done.</p></div>
      <div className="toolbar-inline"><CompactFilter label="Find jobs fast"><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All jobs</label><label><input type="radio" checked={filter==="ready"} onChange={()=>setFilter("ready")}/> Ready to assign</label><label><input type="radio" checked={filter==="no-date"} onChange={()=>setFilter("no-date")}/> Missing date</label><label><input type="radio" checked={filter==="assigned"} onChange={()=>setFilter("assigned")}/> Already assigned</label><label><input type="radio" checked={filter==="pending-today"} onChange={()=>setFilter("pending-today")}/> Pending today</label><label><input type="radio" checked={filter==="overdue"} onChange={()=>setFilter("overdue")}/> Overdue</label><label><input type="radio" checked={filter==="crew"} onChange={()=>setFilter("crew")}/> Current crew</label><label><input type="radio" checked={filter==="done"} onChange={()=>setFilter("done")}/> Done</label><hr/><label>City<select className="input" value={city} onChange={e=>setCity(e.target.value)}><option value="all">All cities</option>{cities.map(c=><option key={c}>{c}</option>)}</select></label></CompactFilter><button className="btn btn-outline" onClick={()=>void refresh()}>Refresh Database</button><Link className="btn btn-outline" href={`/admin/routes?crew=${encodeURIComponent(crew)}&day=${encodeURIComponent(routeDay)}`}>Review Routes</Link><Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(crew)}&day=${encodeURIComponent(routeDay)}`}>Open Employee Route</Link></div>
    </div>

    <section className="card profile-card" style={{marginBottom:20}}>
      <div className="table-head"><div><h2>Create Route</h2><p className="section-intro">For 20 houses: click Select Available, choose date/crew, then Create Route. Already assigned houses are locked and cannot be selected again.</p></div><span className="pill">{selected.length} selected</span></div>
      <div className="form-grid">
        <div className="field"><label>Service Date</label><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/><small>{routeDay}</small></div>
        <div className="field"><label>Window</label><select className="input" value={serviceWindow} onChange={e=>setServiceWindow(e.target.value)}><option>Morning</option><option>Afternoon</option><option>Evening</option><option>Flexible</option></select></div>
        <div className="field"><label>Employee / Crew</label><select className="input" value={crew} onChange={e=>setCrew(e.target.value)}>{(crews.length?crews.map(item=>item.name):DAMASIO_CREWS).map(c=><option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="row" style={{marginTop:16}}>
        <button className="btn btn-outline" onClick={selectUnscheduled}>Select Available</button>
        <button className="btn btn-outline" onClick={selectDateRoute} disabled={!date}>Select This Date</button>
        <button className="btn btn-outline" onClick={toggleAll}>{allSelected?"Unselect All":"Select All"}</button>
        <button className="btn btn-primary" disabled={busy} onClick={()=>void createRoute()}>{busy?"Publishing…":"Create Route"}</button>
      </div>
      {message&&<div className="payment-message" style={{marginTop:14}}>{message}</div>}
    </section>

    <section className="quick-actions crew-cards" style={{marginBottom:20}}>
      <div className="quick-action"><span>1</span><strong>Select houses</strong><small>One, many or all open jobs</small></div>
      <div className="quick-action"><span>2</span><strong>Choose date & crew</strong><small>Route day is set automatically</small></div>
      <div className="quick-action"><span>3</span><strong>Create route</strong><small>Employee sees it immediately</small></div>
    </section>

    <section className="card table-card">
      <div className="table-head"><div><h2>Houses / Jobs</h2><p className="section-intro">Use the checkboxes for batch route creation. Single Assign is available for quick changes.</p></div><span className="pill">{available.length} available · {assigned.length} assigned · filter: {filter}</span></div>
      <div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th><th>Customer</th><th>Service</th><th>Next Cut</th><th>Day</th><th>Crew</th><th>Status</th><th>Action</th></tr></thead><tbody>{visible.length===0?<tr><td colSpan={8}>No database jobs yet. Create or approve jobs first.</td></tr>:visible.map(l=>{const canAssign=isLeadAvailableForRoute(l);return <tr key={l.id} style={!canAssign?{opacity:.62}:undefined}><td><input type="checkbox" checked={selected.includes(l.id)} onChange={()=>toggle(l.id)} disabled={!canAssign}/></td><td><strong>{l.name}</strong><br/><small>{l.address}</small>{!canAssign&&<><br/><small>Locked: assigned to {l.assignedCrew||"route"} {l.scheduledDate?`on ${l.scheduledDate}`:""}</small></>}</td><td>{l.service}</td><td>{l.nextVisitDate||l.scheduledDate||"Not scheduled"}</td><td>{l.serviceDay||"-"}</td><td>{l.assignedCrew||"-"}</td><td>{canAssign?"available":l.status}</td><td><div className="row">{canAssign?<button className="btn btn-outline" onClick={()=>void assignOne(l.id)} disabled={!date||busy}>Assign</button>:<><span className="btn btn-outline" aria-disabled="true">Assigned</span><button className="route-reset-btn" title="Remove from route and make available again" aria-label={`Reset ${l.name} assignment`} disabled={busy} onClick={()=>void resetVisit(l.id,l.name)}>↻</button></>}</div></td></tr>})}</tbody></table></div>
    </section>
  </AdminShell>
}
