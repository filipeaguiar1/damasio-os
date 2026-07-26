"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import type { Lead } from "@/lib/storage";

type RouteEmployee={id:string;employeeId:string|null;crewId:string;name:string;email:string;routeStartAddress:string|null};
type Mode="view"|"build"|"smart"|"move";
function todayKey(){return new Date().toISOString().slice(0,10)}
function firstName(name:string){return name.trim().split(/\s+/)[0]||name}
async function accessToken(){const client=getSupabaseBrowserClient()as any;const{data}=await client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Your Admin session expired. Sign in again.");return token}

export default function RoutesPage(){
  const searchParams=useSearchParams();
  const[leads,setLeads]=useState<Lead[]>([]);
  const[employees,setEmployees]=useState<RouteEmployee[]>([]);
  const[employeeId,setEmployeeId]=useState("");
  const[targetEmployeeId,setTargetEmployeeId]=useState("");
  const[date,setDate]=useState(todayKey());
  const[targetDate,setTargetDate]=useState(todayKey());
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
      if(realEmployees.length&&!realEmployees.some(item=>item.id===targetEmployeeId))setTargetEmployeeId(realEmployees[1]?.id||realEmployees[0].id);
      if(!realEmployees.length){setEmployeeId("");setTargetEmployeeId("")}
      setMessage(realEmployees.length?"":"No Employees have been added yet. Add an Employee before assigning customers.");
    }catch(error){setMessage(error instanceof Error?error.message:"Routes could not be loaded.")}
  }

  useEffect(()=>{const requested=searchParams.get("tab");if(requested==="view"||requested==="build"||requested==="smart"||requested==="move")setMode(requested)},[searchParams]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),15000);return()=>window.clearInterval(timer)},[]);

  const employee=employees.find(item=>item.id===employeeId)||null;
  const targetEmployee=employees.find(item=>item.id===targetEmployeeId)||null;
  const jobs=useMemo(()=>leads.filter(item=>!item.canonicalVisitId),[leads]);
  const available=useMemo(()=>jobs.filter(item=>!item.assignedCrew),[jobs]);
  const assigned=useMemo(()=>jobs.filter(item=>Boolean(item.assignedCrew)),[jobs]);
  const employeeCustomers=useMemo(()=>employee?assigned.filter(item=>item.assignedCrew===employee.name).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)):[],[assigned,employee]);
  const employeeDayRoute=useMemo(()=>employeeCustomers.filter(item=>!item.scheduledDate||item.scheduledDate===date),[employeeCustomers,date]);
  const normalized=query.trim().toLowerCase();
  const buildAvailable=useMemo(()=>available.filter(item=>!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized)).sort((a,b)=>a.address.localeCompare(b.address)),[available,normalized]);
  const smartCandidates=useMemo(()=>employeeCustomers.filter(item=>!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized)),[employeeCustomers,normalized]);
  const moveCandidates=useMemo(()=>employeeCustomers.filter(item=>(!item.scheduledDate||item.scheduledDate===date)&&(!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized))),[employeeCustomers,date,normalized]);
  const selectedJobs=jobs.filter(item=>selected.includes(item.id));
  const buildMapHomes=useMemo(()=>[...employeeCustomers.map(item=>({...item,status:"completed" as const})),...available],[employeeCustomers,available]);

  function changeMode(next:Mode){setMode(next);setSelected([]);setQuery("");window.history.replaceState(null,"",`/admin/routes?tab=${next}`)}
  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}
  function selectVisible(items:Lead[]){const ids=items.map(item=>item.id);setSelected(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])])}

  async function save(action:"assign"|"smart"|"move"){
    const destination=action==="move"?targetEmployee:employee;
    if(!destination){setMessage("Select the destination Employee.");return}
    if(!selectedJobs.length){setMessage("Select at least one customer property.");return}
    if((action==="smart"||action==="move")&&!(action==="move"?targetDate:date)){setMessage("Select a route date.");return}
    setBusy(true);
    try{
      const token=await accessToken();
      const response=await fetch("/api/admin/routes",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({action,jobIds:selectedJobs.map(item=>item.canonicalJobId||item.id),crewId:destination.crewId,routeDate:action==="move"?targetDate:action==="smart"?date:undefined})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"The route change could not be saved.");
      setSelected([]);
      setMessage(action==="assign"?`${result.count} customer${result.count===1?"":"s"} assigned to ${destination.name}.`:action==="move"?`${result.count} house${result.count===1?"":"s"} moved to ${destination.name} on ${targetDate}.`:`Smart route saved for ${destination.name} on ${date}.`);
      await refresh();
      if(action==="assign")changeMode("build");else changeMode("view");
    }catch(error){setMessage(error instanceof Error?error.message:"The route change could not be saved.")}
    finally{setBusy(false)}
  }

  const pageTitle=mode==="build"?"Assign customers to an Employee.":mode==="smart"?"Build the daily Smart Route.":mode==="move"?"Move houses between Employees.":employee?`${employeeDayRoute.length} stops for ${employee.name}.`:"Select an Employee.";

  return <AdminShell active="Routes">
    <section className="desktop-route-studio">
      <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{pageTitle}</h1><p>Build assigns customer ownership. Smart Route creates the dated stop order. Move transfers selected houses to another Employee and date.</p></div><div className="desktop-route-actions"><button className="btn btn-outline" onClick={()=>void refresh()} disabled={busy}>Refresh</button>{employee&&<Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(employee.name)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}</div></header>

      <nav className="desktop-route-modes" aria-label="Route mode"><button className={mode==="view"?"active":""} onClick={()=>changeMode("view")}>View</button><button className={mode==="build"?"active":""} onClick={()=>changeMode("build")}>Build</button><button className={mode==="smart"?"active":""} onClick={()=>changeMode("smart")}>Smart Route</button><button className={mode==="move"?"active":""} onClick={()=>changeMode("move")}>Move</button></nav>

      {mode!=="move"&&<section className="desktop-route-controls route-controls-dynamic"><label><span>Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}} disabled={!employees.length}><option value="">{employees.length?"Select Employee":"No Employees added"}</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{mode!=="build"&&<label><span>Day</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSelected([])}}/></label>}<label className="route-search"><span>Search customers</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, address, city or service"/></label></section>}

      {message&&<div className="desktop-route-message">{message}</div>}

      {!employees.length?<section className="card profile-card" style={{marginTop:18}}><h2>No route team available</h2><p>Add the first Employee in the Employees area.</p></section>:<>
        {mode==="view"&&<section className="desktop-route-workspace"><article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>Route Map</strong><span>{employeeDayRoute.length} properties</span></div></div><EmployeeRouteMap route={employeeDayRoute} desktop actionLabel="Open customer" onOpenVisit={()=>{}}/></article><aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{employee?.name}</strong><span>{date}</span></div><div className="desktop-route-list">{employeeDayRoute.map((home,index)=><button key={home.id} type="button"><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.name} · {home.service}</small></div><i className="done">Assigned</i></button>)}{!employeeDayRoute.length&&<div className="desktop-route-empty"><strong>No stops for this date.</strong><p>Use Smart Route to create the dated order.</p></div>}</div></aside></section>}

        {mode==="build"&&<section className="desktop-route-workspace"><article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>Employee customers and available houses</strong><span>{employeeCustomers.length} assigned · {available.length} available</span></div></div><EmployeeRouteMap route={buildMapHomes} desktop actionLabel="Select customer" onOpenVisit={home=>{if(!home.assignedCrew)toggle(home.id)}}/><div className="route-map-legend"><span><i className="green"></i>{employee?.name} customers</span><span><i className="blue"></i>Available customers</span></div></article><aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{buildAvailable.length} available</span></div><button type="button" className="btn btn-outline route-select-all" onClick={()=>selectVisible(buildAvailable)} disabled={!buildAvailable.length}>Select visible customers</button><div className="desktop-route-list">{buildAvailable.map((home,index)=><button key={home.id} type="button" className={selected.includes(home.id)?"selected":""} onClick={()=>toggle(home.id)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.name} · {home.service}</small></div><i>Available</i></button>)}{!buildAvailable.length&&<div className="desktop-route-empty"><strong>No available customers.</strong><p>All accepted customers are already assigned.</p></div>}</div><div className="desktop-route-build-box"><small>This only assigns customers to {employee?.name}. It does not create a dated route.</small><button className="btn btn-primary" disabled={busy||!selected.length||!employee} onClick={()=>void save("assign")}>{busy?"Assigning...":`Assign ${selected.length} customers`}</button></div></aside></section>}

        {mode==="smart"&&<section className="desktop-route-workspace"><article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>Smart Route preview</strong><span>{smartCandidates.length} assigned customers</span></div></div><EmployeeRouteMap route={selected.length?selectedJobs:smartCandidates} desktop actionLabel="Select stop" onOpenVisit={home=>toggle(home.id)}/></article><aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{date}</span></div><button type="button" className="btn btn-outline route-select-all" onClick={()=>selectVisible(smartCandidates)} disabled={!smartCandidates.length}>Select all assigned customers</button><div className="desktop-route-list">{smartCandidates.map((home,index)=><button key={home.id} type="button" className={selected.includes(home.id)?"selected":""} onClick={()=>toggle(home.id)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.name} · {home.service}</small></div><i className="done">Assigned</i></button>)}</div><div className="desktop-route-build-box"><small>The selected order becomes the Employee route for {date}.</small><button className="btn btn-primary" disabled={busy||!selected.length||!employee} onClick={()=>void save("smart")}>{busy?"Saving...":`Create Smart Route (${selected.length})`}</button></div></aside></section>}

        {mode==="move"&&<section className="route-move-panel"><div className="route-move-row"><label><span>Remove from Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}}>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Current date</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSelected([])}}/></label></div><div className="route-move-list"><div className="desktop-route-side-head"><strong>Select houses to remove</strong><span>{moveCandidates.length} found</span></div><div className="desktop-route-list">{moveCandidates.map((home,index)=><button key={home.id} type="button" className={selected.includes(home.id)?"selected":""} onClick={()=>toggle(home.id)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.name} · {home.service}</small></div><i className="done">{employee?.name}</i></button>)}{!moveCandidates.length&&<div className="desktop-route-empty"><strong>No houses found for this Employee and date.</strong></div>}</div></div><div className="route-move-divider">Move selected houses to</div><div className="route-move-row"><label><span>Destination Employee</span><select value={targetEmployeeId} onChange={event=>setTargetEmployeeId(event.target.value)}>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>New date</span><input type="date" value={targetDate} onChange={event=>setTargetDate(event.target.value)}/></label></div><button className="btn btn-primary route-move-submit" disabled={busy||!selected.length||!targetEmployee} onClick={()=>void save("move")}>{busy?"Moving...":`Move ${selected.length} selected houses`}</button></section>}
      </>}
    </section>

    <style jsx global>{`
      .route-controls-dynamic{grid-template-columns:repeat(3,minmax(180px,1fr))}.route-controls-dynamic:has(label:nth-child(2):last-child){grid-template-columns:repeat(2,minmax(220px,1fr))}
      .desktop-route-controls .route-search input{width:100%}.route-select-all{margin:14px 14px 0;width:calc(100% - 28px)}
      .route-map-legend{display:flex;gap:18px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid #e3ece7}.route-map-legend span{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12px}.route-map-legend i{width:12px;height:12px;border-radius:50%}.route-map-legend i.green{background:#16a34a}.route-map-legend i.blue{background:#2563eb}
      .route-move-panel{display:grid;gap:18px;margin-top:18px;padding:22px;border:1px solid #dbe7e1;border-radius:22px;background:#fff}.route-move-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.route-move-row label{display:grid;gap:7px}.route-move-row span{font-size:12px;font-weight:900;text-transform:uppercase}.route-move-row select,.route-move-row input{min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff}.route-move-divider{text-align:center;font-weight:900;color:#0b684c;padding:12px;border-top:1px solid #e4ece8;border-bottom:1px solid #e4ece8}.route-move-submit{width:100%}
      @media(max-width:900px){.route-controls-dynamic,.route-move-row{grid-template-columns:1fr}.desktop-route-workspace{grid-template-columns:1fr}.desktop-route-modes{overflow-x:auto}.desktop-route-modes button{min-width:120px}}
    `}</style>
  </AdminShell>
}
