"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadSchedulingDispatchBoard, publishJobRoutePattern, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { Lead } from "@/lib/storage";

type RouteEmployee={id:string;employeeId:string|null;crewId:string;name:string;email:string;routeStartAddress:string|null};
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
  const[message,setMessage]=useState("Loading routes...");
  const[busy,setBusy]=useState(false);

  async function refresh(){
    try{
      const token=await accessToken();
      const[board,userResponse]=await Promise.all([
        loadSchedulingDispatchBoard({force:true}),
        fetch("/api/admin/users",{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
      ]);
      const userResult=await userResponse.json();
      if(!userResponse.ok)throw new Error(userResult.error||"Employees could not be loaded.");
      const realEmployees:RouteEmployee[]=(userResult.users||[])
        .filter((item:any)=>item.active&&item.crew_id)
        .map((item:any)=>({id:item.id,employeeId:item.employee_id||null,crewId:item.crew_id,name:item.full_name,email:item.email,routeStartAddress:item.route_start_address||item.address_line1||null}));
      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads(board));
      if(realEmployees.length&&!realEmployees.some(item=>item.id===employeeId))setEmployeeId(realEmployees[0].id);
      if(!realEmployees.length)setEmployeeId("");
      setMessage(realEmployees.length?"":"No Employees have been added yet. Add an Employee before publishing routes.");
    }catch(error){setMessage(error instanceof Error?error.message:"Routes could not be loaded.")}
  }

  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer)},[]);

  const employee=employees.find(item=>item.id===employeeId)||null;
  const jobs=useMemo(()=>leads.filter(item=>!item.canonicalVisitId),[leads]);
  const route=useMemo(()=>{
    if(!employee)return[];
    return leads.filter(item=>item.assignedCrew===employee.name&&item.scheduledDate===date).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address));
  },[leads,employee,date]);
  const candidates=useMemo(()=>{
    const normalized=query.trim().toLowerCase();
    return jobs
      .filter(item=>!item.assignedCrew||item.assignedCrew===employee?.name)
      .filter(item=>!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized))
      .sort((a,b)=>a.address.localeCompare(b.address)||a.name.localeCompare(b.name));
  },[jobs,employee,query]);
  const selectedJobs=jobs.filter(item=>selected.includes(item.id));

  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}
  function selectVisible(){const ids=candidates.map(item=>item.id);setSelected(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])])}

  async function publish(){
    if(!employee){setMessage("Select an Employee before creating a route.");return}
    if(!selectedJobs.length){setMessage("Select at least one accepted customer property.");return}
    setBusy(true);
    try{
      for(let index=0;index<selectedJobs.length;index++){
        const item=selectedJobs[index];
        await publishJobRoutePattern({jobId:item.canonicalJobId||item.id,crewId:employee.crewId,routeDate:date,routeOrder:index+1});
      }
      setSelected([]);setMessage(`Route published to ${employee.name}.`);await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Route could not be published.")}
    finally{setBusy(false)}
  }

  return <AdminShell active="Routes">
    <section className="desktop-route-studio">
      <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{employee?`${route.length} stops for ${employee.name}.`:"No Employees yet."}</h1><p>Select one Employee, search customers by name, address, city or service, choose multiple properties and publish the route.</p></div><div className="desktop-route-actions"><button className="btn btn-outline" onClick={()=>void refresh()} disabled={busy}>Refresh</button>{employee&&<Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(employee.name)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}</div></header>

      <section className="desktop-route-controls"><label><span>Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}} disabled={!employees.length}><option value="">{employees.length?"Select Employee":"No Employees added"}</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Day</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSelected([])}}/></label><label className="route-search"><span>Search customers</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, address, city or service"/></label></section>

      {message&&<div className="desktop-route-message">{message}</div>}

      {!employees.length?<section className="card profile-card" style={{marginTop:18}}><h2>No route team available</h2><p>Add the first Employee in the Employees area.</p></section>:<section className="desktop-route-workspace">
        <article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>Route Map</strong><span>{route.length} stops</span></div></div><EmployeeRouteMap route={route} desktop actionLabel="Open visit" onOpenVisit={()=>{}}/></article>
        <aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{candidates.length} available</span></div><button type="button" className="btn btn-outline route-select-all" onClick={selectVisible} disabled={!candidates.length}>Select visible customers</button><div className="desktop-route-list">{candidates.map(home=><button key={home.id} type="button" className={selected.includes(home.id)?"selected":""} onClick={()=>toggle(home.id)}><span>{firstName(home.name)} — {home.address}</span><small>{home.name} · {home.service}</small></button>)}{!candidates.length&&<div className="empty-state"><strong>No customers found.</strong><p>Try another search or accept a pending Master offer first.</p></div>}</div><button className="btn btn-primary" disabled={busy||!selected.length} onClick={()=>void publish()}>{busy?"Publishing...":`Assign ${selected.length} customers and build route`}</button></aside>
      </section>}
    </section>

    <style jsx global>{`
      .desktop-route-controls{grid-template-columns:minmax(180px,1fr) minmax(170px,.7fr) minmax(260px,1.4fr)}
      .desktop-route-controls .route-search input{width:100%}
      .desktop-route-list{display:grid;gap:8px;margin-bottom:14px}.desktop-route-list button{display:grid;text-align:left;border:1px solid #d5e1db;background:#fff;border-radius:12px;padding:12px;cursor:pointer}.desktop-route-list button.selected{border-color:#0b684c;background:#edf8f3}.desktop-route-list button span{font-weight:850}.desktop-route-list button small{margin-top:4px;color:#667a71}.desktop-route-side>.btn{width:100%}.desktop-route-controls select:disabled{opacity:.65;cursor:not-allowed}.route-select-all{margin-bottom:12px}
      @media(max-width:900px){.desktop-route-controls{grid-template-columns:1fr}}
    `}</style>
  </AdminShell>;
}
