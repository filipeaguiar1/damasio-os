"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { CompactFilter } from "@/components/admin/CompactFilter";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { DAMASIO_CREWS, Lead, isLeadAvailableForRoute } from "@/lib/storage";
import { assignJobToCrew, loadSchedulingDispatchBoard, publishJobRoutePattern, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { DispatchCrew } from "@/lib/repositories/schedulingRepository";

export default function Schedule(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [crew,setCrew]=useState(DAMASIO_CREWS[0]);
  const [selected,setSelected]=useState<string[]>([]);
  const [message,setMessage]=useState("Choose customers and assign them to an Employee / Crew.");
  const [filter,setFilter]=useState("all");
  const [city,setCity]=useState("all");
  const [crews,setCrews]=useState<DispatchCrew[]>([]);
  const [busy,setBusy]=useState(false);
  const [routeDate,setRouteDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [startAddress,setStartAddress]=useState("");
  const [routeDraft,setRouteDraft]=useState<Lead[]>([]);
  const [builderOpen,setBuilderOpen]=useState(true);

  async function refresh(){try{const board=await loadSchedulingDispatchBoard({force:true});setLeads(schedulingBoardToLeads(board));setCrews(board.crews)}catch(error){setMessage(error instanceof Error?error.message:"Database route could not be loaded.")}}
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer)},[]);

  const cities=useMemo(()=>[...new Set(leads.map(l=>l.address.split(",").pop()?.trim()||"Other"))].sort(),[leads]);
  const jobs=useMemo(()=>leads.filter(l=>!l.canonicalVisitId),[leads]);
  const visible=useMemo(()=>[...jobs].filter(l=>{
    const inferredCity=l.address.split(",").pop()?.trim()||"Other";
    if(city!=="all"&&inferredCity!==city)return false;
    if(filter==="ready")return isLeadAvailableForRoute(l);
    if(filter==="assigned")return Boolean(l.assignedCrew);
    if(filter==="done")return l.status==="completed";
    if(filter==="crew")return l.assignedCrew===crew;
    return true;
  }).sort((a,b)=>a.address.localeCompare(b.address)),[jobs,filter,crew,city]);
  const available=visible.filter(isLeadAvailableForRoute);
  const assigned=visible.filter(l=>!isLeadAvailableForRoute(l));
  const allSelected=available.length>0&&available.every(l=>selected.includes(l.id));

  function toggle(id:string){setRouteDraft([]);setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
  function selectUnscheduled(){setRouteDraft([]);setSelected(available.map(l=>l.id));setMessage(`${available.length} available house(s) selected.`)}
  function toggleAll(){setRouteDraft([]);setSelected(allSelected?[]:available.map(l=>l.id))}

  async function previewSmartRoute(){
    const homes=jobs.filter(home=>selected.includes(home.id));
    if(!homes.length){setMessage("Select at least one house first.");return}
    setBusy(true);setMessage("Mapping the selected houses and preparing the best order...");
    try{
      const mapped=(await Promise.all(homes.map(async home=>{
        if(Number.isFinite(home.latitude)&&Number.isFinite(home.longitude))return home;
        const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(home.address)}`,{cache:"no-store"});
        if(!response.ok)return home;
        return {...home,...await response.json() as {latitude:number;longitude:number}};
      })));
      const located=mapped.filter(home=>Number.isFinite(home.latitude)&&Number.isFinite(home.longitude));
      let ordered=[...mapped].sort((a,b)=>a.address.localeCompare(b.address));
      if(located.length>1){
        let origin:[number,number]|undefined;
        if(startAddress.trim()){
          const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(startAddress.trim())}`,{cache:"no-store"});
          if(response.ok){const point=await response.json() as {latitude:number;longitude:number};origin=[point.longitude,point.latitude]}
        }
        const first=origin||[Number(located[0].longitude),Number(located[0].latitude)] as [number,number];
        const response=await fetch("/api/map/optimize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({start:first,coordinates:located.map(home=>[Number(home.longitude),Number(home.latitude)])})});
        if(response.ok){const result=await response.json() as {order:number[]};const optimized=result.order.map(index=>located[index]).filter(Boolean);const unmapped=mapped.filter(home=>!located.some(item=>item.id===home.id));ordered=[...optimized,...unmapped]}
      }
      setRouteDraft(ordered);setMessage("Preview ready. Check the map and the stop order, then publish to the Employee.");
    }catch{setRouteDraft([...homes].sort((a,b)=>a.address.localeCompare(b.address)));setMessage("The driving optimizer is unavailable, so a safe address order was prepared for review.")}
    finally{setBusy(false)}
  }

  async function publishSmartRoute(){
    if(!routeDraft.length){setMessage("Generate the route preview before publishing.");return}
    const crewId=crews.find(item=>item.name===crew)?.id;if(!crewId){setMessage("Choose a valid Employee / Crew.");return}
    if(!window.confirm(`Send ${routeDraft.length} house(s) to ${crew} for ${routeDate}?`))return;
    setBusy(true);
    try{for(let index=0;index<routeDraft.length;index++){const home=routeDraft[index];await publishJobRoutePattern({jobId:home.canonicalJobId||home.id,crewId,routeDate,routeOrder:index+1})}setMessage(`Route published. ${crew} can now see the houses, order and map for ${routeDate}.`);setSelected([]);setRouteDraft([]);await refresh()}
    catch(error){setMessage(error instanceof Error?error.message:"Route could not be published.")}
    finally{setBusy(false)}
  }

  async function assignOne(id:string){
    const crewId=crews.find(item=>item.name===crew)?.id;if(!crewId){setMessage("Choose a valid crew.");return}
    setBusy(true);try{await assignJobToCrew(id,crewId);setMessage("Customer assigned to the crew. Choose the service day in Routes.");await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Customer could not be assigned.")}finally{setBusy(false)}
  }

  async function assignSelected(){
    if(selected.length===0){setMessage("Select at least one customer.");return;}
    const crewId=crews.find(item=>item.name===crew)?.id;if(!crewId){setMessage("Choose a valid crew.");return}
    setBusy(true);try{for(const id of selected)await assignJobToCrew(id,crewId);setMessage(`${selected.length} customer(s) assigned to ${crew}. They are now available in Routes.`);setSelected([]);await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Customers could not be assigned.")}finally{setBusy(false)}
  }

  async function resetJob(id:string,name:string){if(!window.confirm(`Remove ${name} from this crew? The customer remains active and returns to Unassigned.`))return;setBusy(true);try{await assignJobToCrew(id,null);setMessage(`${name} returned to Unassigned.`);await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Assignment could not be reset.")}finally{setBusy(false)}}

  return <AdminShell active="Dispatch & Routes"><div className="mobile-admin-workspace route-builder-page">
    <div className="app-top">
      <div><span className="eyebrow">Customer → Dispatch → Route</span><h1>Dispatch & Routes</h1><p className="section-intro">Assign houses, choose the Employee and date, optimize the route and publish from one screen.</p></div>
      <div className="toolbar-inline"><CompactFilter label="Find jobs fast"><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All jobs</label><label><input type="radio" checked={filter==="ready"} onChange={()=>setFilter("ready")}/> Unassigned</label><label><input type="radio" checked={filter==="assigned"} onChange={()=>setFilter("assigned")}/> Assigned</label><label><input type="radio" checked={filter==="crew"} onChange={()=>setFilter("crew")}/> Current crew</label><hr/><label>City<select className="input" value={city} onChange={e=>setCity(e.target.value)}><option value="all">All cities</option>{cities.map(c=><option key={c}>{c}</option>)}</select></label></CompactFilter><button className="btn btn-outline" onClick={()=>void refresh()}>Refresh Database</button><Link className="btn btn-primary" href={`/admin/routes?crew=${encodeURIComponent(crew)}`}>Manage Routes</Link></div>
    </div>

    <section className="card profile-card route-builder-card" style={{marginBottom:20}}>
      <div className="table-head"><div><span className="route-builder-kicker">SMART ROUTE</span><h2>Create and send a route</h2><p className="section-intro">Select houses below, choose the Employee and date, preview the map, then publish.</p></div><button type="button" className="route-builder-collapse" onClick={()=>setBuilderOpen(value=>!value)}>{builderOpen?"Hide":"Open"}</button></div>
      {builderOpen&&<><div className="route-builder-steps"><span className={selected.length?"done":"active"}><b>1</b>Select houses</span><span className={selected.length&&!routeDraft.length?"active":""}><b>2</b>Preview route</span><span className={routeDraft.length?"active":""}><b>3</b>Publish</span></div>
      <div className="route-builder-fields">
        <div className="field"><label>Employee / Crew</label><select className="input" value={crew} onChange={e=>{setCrew(e.target.value);setRouteDraft([])}}>{(crews.length?crews.map(item=>item.name):DAMASIO_CREWS).map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Route date</label><input className="input" type="date" value={routeDate} onChange={e=>{setRouteDate(e.target.value);setRouteDraft([])}}/></div>
        <div className="field route-start-field"><label>Start from (optional)</label><AddressAutocomplete value={startAddress} onChange={value=>{setStartAddress(value);setRouteDraft([])}} placeholder="Employee location or manual address" ariaLabel="Route starting address"/></div>
      </div>
      <div className="row" style={{marginTop:16}}>
        <button className="btn btn-outline" onClick={selectUnscheduled}>Select Available</button>
        <button className="btn btn-outline" onClick={toggleAll}>{allSelected?"Unselect All":"Select All"}</button>
        <button className="btn btn-primary" disabled={busy||!selected.length} onClick={()=>void previewSmartRoute()}>{busy?"Preparing…":"Preview Smart Route"}</button>
      </div>
      {routeDraft.length>0&&<div className="route-builder-preview"><div className="route-builder-preview-head"><div><strong>Route preview</strong><span>{routeDraft.length} stops · {crew} · {routeDate}</span></div><button className="btn btn-primary" disabled={busy} onClick={()=>void publishSmartRoute()}>{busy?"Publishing…":"Confirm & Send"}</button></div><EmployeeRouteMap route={routeDraft} actionLabel="Select stop" onOpenVisit={lead=>setMessage(`${lead.name}: ${lead.address}`)}/><ol>{routeDraft.map((home,index)=><li key={home.id}><b>{index+1}</b><span><strong>{home.name}</strong><small>{home.address}</small></span></li>)}</ol></div>}
      {message&&<div className="payment-message" style={{marginTop:14}}>{message}</div>}
      </>}
    </section>

    <section className="quick-actions crew-cards" style={{marginBottom:20}}>
      <div className="quick-action"><span>1</span><strong>Select houses</strong><small>One, many or all open jobs</small></div>
      <div className="quick-action"><span>2</span><strong>Choose Employee / Crew</strong><small>No service date is required here</small></div>
      <div className="quick-action"><span>3</span><strong>Open Routes</strong><small>Choose day and save recurring order</small></div>
    </section>

    <section className="card table-card">
      <div className="table-head"><div><h2>Houses / Jobs</h2><p className="section-intro">Use the checkboxes for batch route creation. Single Assign is available for quick changes.</p></div><span className="pill">{available.length} available · {assigned.length} assigned · filter: {filter}</span></div>
      <div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th><th>Customer</th><th>Service</th><th>Frequency</th><th>Crew</th><th>Status</th><th>Action</th></tr></thead><tbody>{visible.length===0?<tr><td colSpan={7}>No active jobs. Create a client with a service or accept a Master referral.</td></tr>:visible.map(l=>{const canAssign=isLeadAvailableForRoute(l);return <tr key={l.id} style={!canAssign?{opacity:.72}:undefined}><td><input type="checkbox" checked={selected.includes(l.id)} onChange={()=>toggle(l.id)} disabled={!canAssign}/></td><td><strong>{l.name}</strong><br/><small>{l.address}</small></td><td>{l.service}</td><td>{l.serviceFrequency||"one time"}</td><td>{l.assignedCrew||"Unassigned"}</td><td>{canAssign?"available":"assigned"}</td><td><div className="row">{canAssign?<button className="btn btn-outline" onClick={()=>void assignOne(l.id)} disabled={busy}>Assign</button>:<><span className="btn btn-outline" aria-disabled="true">Assigned</span><button className="route-reset-btn" title="Return to Unassigned" aria-label={`Reset ${l.name} assignment`} disabled={busy} onClick={()=>void resetJob(l.id,l.name)}>↻</button></>}</div></td></tr>})}</tbody></table></div>
    </section>
  </div></AdminShell>
}
