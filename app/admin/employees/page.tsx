"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {DAMASIO_CREWS,DAMASIO_SYNC_EVENT,Lead,getLeads,seedDemoLeads,setLeads,broadcastOperationsChange} from "@/lib/storage";

export default function CrewsPage(){
  const[leads,setLocalLeads]=useState<Lead[]>([]);
  const[selectedCrew,setSelectedCrew]=useState(DAMASIO_CREWS[0]);
  const[selected,setSelected]=useState<string[]>([]);
  function refresh(){setLocalLeads(getLeads())}
  useEffect(()=>{seedDemoLeads();refresh();const onSync=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,onSync as EventListener);window.addEventListener("storage",onSync);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,onSync as EventListener);window.removeEventListener("storage",onSync)}},[]);
  const byCrew=useMemo(()=>DAMASIO_CREWS.map(c=>({crew:c,homes:leads.filter(l=>l.assignedCrew===c).sort((a,b)=>(a.serviceDay||"").localeCompare(b.serviceDay||"")||a.address.localeCompare(b.address))})),[leads]);
  const homes=byCrew.find(c=>c.crew===selectedCrew)?.homes||[];
  function toggle(id:string){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}
  function removeSelected(){const ids=selected;setLeads(getLeads().map(l=>ids.includes(l.id)?{...l,assignedCrew:undefined,status:"new" as const}:l));setSelected([]);refresh();broadcastOperationsChange(`${ids.length} home(s) returned to unassigned.`)}
  function removeAll(){const ids=homes.map(h=>h.id);setLeads(getLeads().map(l=>ids.includes(l.id)?{...l,assignedCrew:undefined,status:"new" as const}:l));setSelected([]);refresh();broadcastOperationsChange(`All homes removed from ${selectedCrew}.`)}
  return <AdminShell active="Crews">
    <div className="calendar-heading"><div><h1>Crew Manager</h1><p>Open each crew, review assigned homes, remove selected homes, or return all homes to the main unassigned list.</p></div><Link className="btn btn-primary" href="/admin/customers">Assign More Homes</Link></div>
    <section className="quick-actions crew-cards">{byCrew.map(c=><button key={c.crew} className={`quick-action ${selectedCrew===c.crew?"active":""}`} onClick={()=>{setSelectedCrew(c.crew);setSelected([])}}><span>{c.homes.length}</span><strong>{c.crew}</strong><small>{c.homes.length} assigned home(s)</small></button>)}</section>
    <section className="card table-card">
      <div className="table-head"><div><h2>{selectedCrew}</h2><p className="section-intro">A home can only belong to one crew at a time. Removing it here returns it to Unassigned Customers.</p></div><div className="row"><button className="btn btn-outline" disabled={!selected.length} onClick={removeSelected}>Remove Selected ({selected.length})</button><button className="btn btn-danger" disabled={!homes.length} onClick={removeAll}>Remove All</button></div></div>
      <div className="pro-route-list">{homes.length===0?<div className="empty-state"><strong>No homes assigned.</strong><p>This crew is free. Assign homes from Customers or Calendar.</p></div>:homes.map((h,i)=><label className="pro-route-row crew-manage-row" key={h.id}><input type="checkbox" checked={selected.includes(h.id)} onChange={()=>toggle(h.id)}/><span className="route-number">{i+1}</span><div className="home-info"><strong>{h.name}</strong><p>{h.address}</p><span className="freq">{h.serviceFrequency||"weekly"}</span></div><div className="booking-cell"><span className="dot booked"></span><strong>{h.serviceDay||"No day"}</strong><p>Next: {h.nextVisitDate||h.scheduledDate||"Not set"}</p></div><Link className="open-btn" href={`/admin/customers/${h.id}`}>Open</Link></label>)}</div>
    </section>
  </AdminShell>
}
