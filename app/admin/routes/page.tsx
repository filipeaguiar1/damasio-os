"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import type { Lead } from "@/lib/storage";

type RouteEmployee={id:string;employeeId:string|null;crewId:string;name:string;email:string;routeStartAddress:string|null};
type Mode="view"|"build"|"move";
function todayKey(){return new Date().toISOString().slice(0,10)}
function firstName(name:string){return name.trim().split(/\s+/)[0]||name}
async function accessToken(){const client=getSupabaseBrowserClient()as any;const{data}=await client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Your Admin session expired. Sign in again.");return token}

export default function RoutesPage(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[employees,setEmployees]=useState<RouteEmployee[]>([]);
  const[employeeId,setEmployeeId]=useState("");
  const[date,setDate]=useState(todayKey());
  const[selected,setSelected]=useState<string[]>([]);
  const[query,setQuery]=useState("");
  const[mode,setMode]=useState<Mode>("view");
  const[message,setMessage]=useState("Loading routes...");
  const[busy,setBusy]=useState(false);

  async function refresh(){
    try{
      const token=await accessToken();
      const response=await fetch("/api/admin/routes",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Routes could not be loaded.");
      const realEmployees:RouteEmployee[]=result.employees||[];
      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads((result.board||{}) as SchedulingDispatchBoard));
      if(realEmployees.length&&!realEmployees.some(item=>item.id===employeeId))setEmployeeId(realEmployees[0].id);
      if(!realEmployees.length)setEmployeeId("");
      setMessage(realEmployees.length?"":"No Employees have been added yet. Add an Employee before publishing routes.");
    }catch(error){setMessage(error instanceof Error?error.message:"Routes could not be loaded.")}
  }

  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),15000);return()=>window.clearInterval(timer)},[]);

  const employee=employees.find(item=>item.id===employeeId)||null;
  const jobs=useMemo(()=>leads.filter(item=>!item.canonicalVisitId),[leads]);
  const available=useMemo(()=>jobs.filter(item=>!item.assignedCrew),[jobs]);
  const assigned=useMemo(()=>jobs.filter(item=>Boolean(item.assignedCrew)),[jobs]);
  const employeeRoute=useMemo(()=>employee?assigned.filter(item=>item.assignedCrew===employee.name).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)):[],[assigned,employee]);
  const normalized=query.trim().toLowerCase();
  const source=mode==="build"?available:mode==="move"?assigned:employeeRoute;
  const candidates=useMemo(()=>source.filter(item=>!normalized||`${item.name} ${item.address} ${item.service} ${item.assignedCrew||""}`.toLowerCase().includes(normalized)).sort((a,b)=>a.address.localeCompare(b.address)||a.name.localeCompare(b.name)),[source,normalized]);
  const selectedJobs=jobs.filter(item=>selected.includes(item.id));
  const mapHomes=mode==="build"?available:mode==="move"?assigned:employeeRoute;

  function changeMode(next:Mode){setMode(next);setSelected([]);setQuery("")}
  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}
  function selectVisible(){const ids=candidates.map(item=>item.id);setSelected(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])])}

  async function publish(){
    if(!employee){setMessage("Select an Employee before creating a route.");return}
    if(!selectedJobs.length){setMessage("Select at least one customer property.");return}
    setBusy(true);
    try{
      const token=await accessToken();
      const response=await fetch("/api/admin/routes",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({jobIds:selectedJobs.map(item=>item.canonicalJobId||item.id),crewId:employee.crewId,routeDate:date})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Route could not be published.");
      setSelected([]);setMessage(mode==="move"?`${result.count} customer${result.count===1?"":"s"} moved to ${employee.name}.`:`Route built for ${employee.name} with ${result.count} stop${result.count===1?"":"s"}.`);await refresh();setMode("view");
    }catch(error){setMessage(error instanceof Error?error.message:"Route could not be published.")}
    finally{setBusy(false)}
  }

  return <AdminShell active="Routes">
    <section className="desktop-route-studio">
      <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{mode==="build"?`${available.length} customers ready to assign.`:mode==="move"?"Move stops between Employees.":employee?`${employeeRoute.length} stops for ${employee.name}.`:"Select an Employee."}</h1><p>Available customers appear on the map and in the list. Numbered markers match the route order.</p></div><div className="desktop-route-actions"><button className="btn btn-outline" onClick={()=>void refresh()} disabled={busy}>Refresh</button>{employee&&<Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(employee.name)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}</div></header>

      <nav className="desktop-route-modes" aria-label="Route mode"><button className={mode==="view"?"active":""} onClick={()=>changeMode("view")}>View</button><button className={mode==="build"?"active":""} onClick={()=>changeMode("build")}>Build</button><button className={mode==="move"?"active":""} onClick={()=>changeMode("move")}>Move</button></nav>

      <section className="desktop-route-controls"><label><span>Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}} disabled={!employees.length}><option value="">{employees.length?"Select Employee":"No Employees added"}</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Day</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSelected([])}}/></label><label className="route-search"><span>Search customers</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, address, city or service"/></label></section>

      {message&&<div className="desktop-route-message">{message}</div>}

      {!employees.length?<section className="card profile-card" style={{marginTop:18}}><h2>No route team available</h2><p>Add the first Employee in the Employees area.</p></section>:<section className="desktop-route-workspace">
        <article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>{mode==="build"?"Available Customer Map":mode==="move"?"Assigned Customer Map":"Route Map"}</strong><span>{mapHomes.length} properties</span></div></div><EmployeeRouteMap route={mapHomes} desktop actionLabel="Select customer" onOpenVisit={home=>{if(mode!=="view")toggle(home.id)}}/></article>
        <aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{candidates.length} available</span></div>{mode!=="view"&&<button type="button" className="btn btn-outline route-select-all" onClick={selectVisible} disabled={!candidates.length}>Select visible customers</button>}<div className="desktop-route-list">{candidates.map((home,index)=><button key={home.id} type="button" className={selected.includes(home.id)?"selected":""} onClick={()=>mode!=="view"&&toggle(home.id)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.name} · {home.service}</small>{mode==="move"&&<em>Currently: {home.assignedCrew||"Unassigned"}</em>}</div><i className={home.assignedCrew?"done":""}>{home.assignedCrew||"Available"}</i></button>)}{!candidates.length&&<div className="desktop-route-empty"><strong>{mode==="build"?"No unassigned customers found.":mode==="move"?"No assigned customers found.":"No stops on this route."}</strong><p>Accepted company customers are loaded automatically.</p></div>}</div>{mode!=="view"&&<div className="desktop-route-build-box"><small>{mode==="move"?"Selected houses will move to the Employee chosen above.":"Selected houses will be assigned and ordered for the Employee chosen above."}</small><button className="btn btn-primary" disabled={busy||!selected.length||!employee} onClick={()=>void publish()}>{busy?"Saving...":mode==="move"?`Move ${selected.length} stops`:`Build route with ${selected.length} stops`}</button></div>}</aside>
      </section>}
    </section>

    <style jsx global>{`
      .desktop-route-controls{grid-template-columns:minmax(180px,1fr) minmax(170px,.7fr) minmax(260px,1.4fr)}
      .desktop-route-controls .route-search input{width:100%}.route-select-all{margin:14px 14px 0;width:calc(100% - 28px)}
      @media(max-width:900px){.desktop-route-controls{grid-template-columns:1fr}}
    `}</style>
  </AdminShell>
}
