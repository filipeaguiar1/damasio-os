"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { DAMASIO_CREWS, DAMASIO_WEEK_DAYS, Lead, getEmployeeTasks } from "@/lib/storage";
import { readRoadGeometry, saveRoadGeometry } from "@/lib/maps/clientMapCache";
import { loadSchedulingDispatchBoard, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import { routeDateForWeekday } from "@/lib/services/routeMapService";

declare global { interface Window { L?: any } }

type RoutePoint = Lead & { lat:number; lng:number; color:string; label:string };
const HAMILTON={lat:43.2557,lng:-79.8711};
function stateFor(lead:Lead){
  let sessions:any[]=[];
  if(typeof window!=="undefined")try{const parsed=JSON.parse(localStorage.getItem("damasio_os_service_sessions")||"[]");sessions=Array.isArray(parsed)?parsed:[]}catch{/* ignore invalid local cache */}
  const session=sessions.find((s:any)=>s.leadId===lead.id);
  const issue=getEmployeeTasks().some(t=>t.leadId===lead.id&&t.status!=="resolved");
  if(issue)return{color:"#dc2626",label:"Issue"};
  if(session?.status==="skipped")return{color:"#eab308",label:"Skipped"};
  if(lead.status==="completed"||session?.status==="finished")return{color:"#16a34a",label:"Done"};
  return{color:"#2563eb",label:"Open"};
}

export default function RouteMap(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[crew,setCrew]=useState(DAMASIO_CREWS[0]);
  const[day,setDay]=useState(DAMASIO_WEEK_DAYS[(new Date().getDay()+6)%7]||"Monday");
  const[selected,setSelected]=useState("");
  const[mode,setMode]=useState<"map"|"list">("map");
  const[located,setLocated]=useState<Lead[]>([]);
  const[roadGeometry,setRoadGeometry]=useState<Array<[number,number]>>([]);
  const mapNode=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<any>(null);
  const layerRef=useRef<any>(null);
  const lineRef=useRef<any>(null);

  async function refresh(){try{const board=await loadSchedulingDispatchBoard({force:true});setLeads(schedulingBoardToLeads(board))}catch{setLeads([])}}
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer)},[]);

  const crews=useMemo(()=>Array.from(new Set(leads.map(l=>l.assignedCrew).filter(Boolean))) as string[],[leads]);
  const crewOptions=crews.length?crews:DAMASIO_CREWS;
  const routeDate=routeDateForWeekday(day);
  const assigned=useMemo(()=>leads
    .filter(l=>l.assignedCrew===crew&&(l.scheduledDate===routeDate||(!l.canonicalVisitId&&l.serviceDay===day)))
    .sort((a,b)=>(a.routeOrder??999)-(b.routeOrder??999)||(a.scheduledDate||a.nextVisitDate||"").localeCompare(b.scheduledDate||b.nextVisitDate||"")||a.address.localeCompare(b.address)),[leads,crew,day]);
  const assignedKey=assigned.map(l=>`${l.id}:${l.address}`).join("|");
  const points=useMemo<RoutePoint[]>(()=>located.flatMap(l=>Number.isFinite(l.latitude)&&Number.isFinite(l.longitude)?[{...l,lat:Number(l.latitude),lng:Number(l.longitude),...stateFor(l)}]:[]),[located]);
  const current=points.find(p=>p.id===selected)||points[0];
  const done=points.filter(p=>p.label==="Done").length;
  const skipped=points.filter(p=>p.label==="Skipped").length;

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const ready=assigned.filter(home=>Number.isFinite(home.latitude)&&Number.isFinite(home.longitude));
      setLocated(ready);
      const mapped=await Promise.all(assigned.map(async home=>{
        if(Number.isFinite(home.latitude)&&Number.isFinite(home.longitude))return home;
        try{
          const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(home.address)}`,{cache:"no-store"});
          if(!response.ok)throw new Error("Address not found");
          const position=await response.json() as {latitude:number;longitude:number};
          return {...home,...position};
        }catch{return null}
      })).then(values=>values.filter((home):home is Lead=>Boolean(home)));
      if(cancelled)return;
      setLocated(mapped);
      if(mapped.length<2){setRoadGeometry([]);return}
      if(mapped.length>1){
        const coordinates=mapped.map(home=>[Number(home.longitude),Number(home.latitude)] as [number,number]);
        const cached=readRoadGeometry(coordinates);
        if(cached){setRoadGeometry(cached.coordinates);return}
        setRoadGeometry([]);
        try{
          const response=await fetch("/api/map/route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({coordinates})});
          if(!response.ok)throw new Error("Route unavailable");
          const data=await response.json() as {geometry:{type:"LineString";coordinates:Array<[number,number]>}};
          if(!cancelled){saveRoadGeometry(coordinates,data.geometry);setRoadGeometry(data.geometry.coordinates)}
        }catch{/* Keep exact property markers visible when routing is temporarily unavailable. */}
      }
    })();
    return()=>{cancelled=true};
  },[assignedKey]);

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
      if(roadGeometry.length>1)lineRef.current=L.polyline(roadGeometry.map(([lng,lat])=>[lat,lng]),{color:"#2563eb",weight:5,opacity:.82,lineJoin:"round"}).addTo(mapRef.current);
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
  },[points,current?.id,mode,roadGeometry]);

  useEffect(()=>{if(current&&mapRef.current&&mode==="map")mapRef.current.panTo([current.lat,current.lng])},[current?.id,mode]);

  return <AdminShell active="Map">
    <div className="pw-route-page">
      <header className="pw-route-header">
        <div><span className="eyebrow">{crew} · {day}</span><h1>Route map</h1><p>{points.length} properties · {done} done · {skipped} skipped</p></div>
        <div className="pw-route-actions">
          <select value={crew} onChange={e=>{setCrew(e.target.value);setSelected("")}} aria-label="Select crew">{crewOptions.map(c=><option key={c}>{c}</option>)}</select>
          <select value={day} onChange={e=>{setDay(e.target.value);setSelected("")}} aria-label="Select route day">{DAMASIO_WEEK_DAYS.map(value=><option key={value}>{value}</option>)}</select>
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
        {points.length===0&&<div className="empty-state">No assigned properties for this crew and day.</div>}
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
