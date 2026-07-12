"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { DAMASIO_SYNC_EVENT, Lead, getEmployeeTasks, getLeads, seedDemoLeads } from "@/lib/storage";

declare global { interface Window { L?: any } }

type RoutePoint = Lead & { lat:number; lng:number; color:string; label:string };
const HAMILTON={lat:43.2557,lng:-79.8711};
function hash(value:string){let h=0;for(let i=0;i<value.length;i++)h=((h<<5)-h)+value.charCodeAt(i);return Math.abs(h)}
function coordinates(lead:Lead){
  if(typeof lead.latitude==="number"&&typeof lead.longitude==="number")return{lat:lead.latitude,lng:lead.longitude};
  const h=hash(lead.address||lead.id);
  return{lat:HAMILTON.lat+(((h%1700)-850)/30000),lng:HAMILTON.lng+((((Math.floor(h/1700))%1900)-950)/30000)};
}
function stateFor(lead:Lead){
  const sessions=typeof window!=="undefined"?JSON.parse(localStorage.getItem("damasio_os_service_sessions")||"[]"):[];
  const session=sessions.find((s:any)=>s.leadId===lead.id);
  const issue=getEmployeeTasks().some(t=>t.leadId===lead.id&&t.status!=="resolved");
  if(issue)return{color:"#dc2626",label:"Issue"};
  if(session?.status==="skipped")return{color:"#eab308",label:"Skipped"};
  if(lead.status==="completed"||session?.status==="finished")return{color:"#16a34a",label:"Done"};
  return{color:"#2563eb",label:"Open"};
}

export default function RouteMap(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[crew,setCrew]=useState("all");
  const[selected,setSelected]=useState("");
  const[mode,setMode]=useState<"map"|"list">("map");
  const mapNode=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<any>(null);
  const layerRef=useRef<any>(null);
  const lineRef=useRef<any>(null);

  function refresh(){seedDemoLeads();setLeads(getLeads())}
  useEffect(()=>{refresh();const on=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);

  const crews=useMemo(()=>Array.from(new Set(leads.map(l=>l.assignedCrew).filter(Boolean))) as string[],[leads]);
  const points=useMemo<RoutePoint[]>(()=>leads
    .filter(l=>l.assignedCrew&&(crew==="all"||l.assignedCrew===crew))
    .sort((a,b)=>(a.scheduledDate||a.nextVisitDate||"").localeCompare(b.scheduledDate||b.nextVisitDate||"")||a.address.localeCompare(b.address))
    .map(l=>({...l,...coordinates(l),...stateFor(l)})),[leads,crew]);
  const current=points.find(p=>p.id===selected)||points[0];
  const done=points.filter(p=>p.label==="Done").length;
  const skipped=points.filter(p=>p.label==="Skipped").length;

  useEffect(()=>{
    let cancelled=false;
    const setup=()=>{
      if(cancelled||!mapNode.current||!window.L)return;
      const L=window.L;
      if(!mapRef.current){
        mapRef.current=L.map(mapNode.current,{zoomControl:true,attributionControl:true}).setView([HAMILTON.lat,HAMILTON.lng],12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(mapRef.current);
        layerRef.current=L.layerGroup().addTo(mapRef.current);
      }
      layerRef.current.clearLayers();
      if(lineRef.current){mapRef.current.removeLayer(lineRef.current);lineRef.current=null;}
      if(points.length>1)lineRef.current=L.polyline(points.map(p=>[p.lat,p.lng]),{color:"#2563eb",weight:4,opacity:.72}).addTo(mapRef.current);
      points.forEach((p,index)=>{
        const active=current?.id===p.id;
        const icon=L.divIcon({
          className:"pw-marker-shell",
          html:`<div class="pw-marker ${active?"active":""}" style="background:${p.color}">${index+1}</div>`,
          iconSize:[active?38:32,active?38:32],iconAnchor:[active?19:16,active?19:16]
        });
        L.marker([p.lat,p.lng],{icon}).on("click",()=>setSelected(p.id)).addTo(layerRef.current);
      });
      if(points.length){const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lng]));mapRef.current.fitBounds(bounds.pad(.12),{maxZoom:15});}
      window.setTimeout(()=>mapRef.current?.invalidateSize(),80);
    };
    if(window.L){setup();return()=>{cancelled=true}};
    if(!document.querySelector("link[data-leaflet]")){const link=document.createElement("link");link.rel="stylesheet";link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";link.dataset.leaflet="true";document.head.appendChild(link)}
    let script=document.querySelector("script[data-leaflet]") as HTMLScriptElement|null;
    if(!script){script=document.createElement("script");script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";script.async=true;script.dataset.leaflet="true";document.body.appendChild(script)}
    script.addEventListener("load",setup);
    return()=>{cancelled=true;script?.removeEventListener("load",setup)};
  },[points,current?.id,mode]);

  useEffect(()=>{if(current&&mapRef.current&&mode==="map")mapRef.current.panTo([current.lat,current.lng])},[current?.id,mode]);

  return <AdminShell active="Map">
    <div className="pw-route-page">
      <header className="pw-route-header">
        <div><span className="eyebrow">Today&apos;s route</span><h1>Route map</h1><p>{points.length} properties · {done} done · {skipped} skipped</p></div>
        <div className="pw-route-actions">
          <select value={crew} onChange={e=>{setCrew(e.target.value);setSelected("")}} aria-label="Select crew"><option value="all">All crews</option>{crews.map(c=><option key={c}>{c}</option>)}</select>
          <Link className="btn btn-outline" href="/admin/schedule">Schedule</Link>
        </div>
      </header>

      <div className="pw-view-tabs" role="tablist">
        <button className={mode==="list"?"active":""} onClick={()=>setMode("list")}>List view</button>
        <button className={mode==="map"?"active":""} onClick={()=>setMode("map")}>Map view</button>
      </div>

      {mode==="list"?<section className="pw-route-list">
        {points.map((p,index)=><button key={p.id} onClick={()=>{setSelected(p.id);setMode("map")}}>
          <span className="pw-list-number" style={{background:p.color}}>{index+1}</span>
          <div><strong>{p.address}</strong><span>{p.name} · {p.service}</span></div>
          <em>{p.label}</em>
        </button>)}
        {points.length===0&&<div className="empty-state">No assigned properties for this crew.</div>}
      </section>:<section className="pw-map-stage">
        <div ref={mapNode} className="pw-route-map" aria-label="Interactive route map"/>
        <div className="pw-map-legend"><span><i className="open"/>Open</span><span><i className="done"/>Done</span><span><i className="skip"/>Skipped</span><span><i className="issue"/>Issue</span></div>
        {current&&<article className="pw-property-sheet">
          <div className="pw-property-photo">{current.propertyPhoto?<img src={current.propertyPhoto} alt="Property"/>:<span>🏠</span>}</div>
          <div className="pw-property-copy"><div><strong>{current.address}</strong><span>{current.name}</span></div><small>{current.service} · {current.assignedCrew}</small></div>
          <b style={{color:current.color}}>{current.label}</b>
          <div className="pw-property-buttons"><Link href={`/admin/customers?property=${current.id}`}>Open property</Link><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(current.address)}`} target="_blank" rel="noreferrer">Directions</a></div>
        </article>}
      </section>}
    </div>
  </AdminShell>;
}
