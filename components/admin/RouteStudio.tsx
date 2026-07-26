"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { CustomerPropertyModal } from "@/components/property/CustomerPropertyModal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import type { Lead } from "@/lib/storage";

type RouteEmployee={id:string;employeeId:string|null;crewId:string;name:string;email:string;routeStartAddress:string|null};
type Mode="view"|"build"|"smart"|"move";
type StartMode="employee"|"manual";
type Origin={latitude:number;longitude:number;label:string};

const todayKey=()=>new Date().toISOString().slice(0,10);
const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name;
async function accessToken(){const client=getSupabaseBrowserClient()as any;const{data}=await client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Your Admin session expired. Sign in again.");return token}

export function RouteStudio(){
  const searchParams=useSearchParams();
  const[leads,setLeads]=useState<Lead[]>([]),[employees,setEmployees]=useState<RouteEmployee[]>([]);
  const[employeeId,setEmployeeId]=useState(""),[targetEmployeeId,setTargetEmployeeId]=useState("");
  const[date,setDate]=useState(todayKey()),[targetDate,setTargetDate]=useState(todayKey());
  const[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState("");
  const[mode,setMode]=useState<Mode>("view"),[message,setMessage]=useState("Loading routes...");
  const[busy,setBusy]=useState(false),[propertyPreview,setPropertyPreview]=useState<Lead|null>(null);
  const[startMode,setStartMode]=useState<StartMode>("employee"),[manualStartAddress,setManualStartAddress]=useState("");
  const[smartPreview,setSmartPreview]=useState<Lead[]>([]),[origin,setOrigin]=useState<Origin|null>(null),[previewBusy,setPreviewBusy]=useState(false);

  async function refresh(silent=false){
    try{const token=await accessToken();const response=await fetch("/api/admin/routes",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Routes could not be loaded.");
      const realEmployees:RouteEmployee[]=result.employees||[];setEmployees(realEmployees);setLeads(schedulingBoardToLeads((result.board||{}) as SchedulingDispatchBoard));
      setEmployeeId(current=>realEmployees.some(item=>item.id===current)?current:realEmployees[0]?.id||"");setTargetEmployeeId(current=>realEmployees.some(item=>item.id===current)?current:realEmployees[1]?.id||realEmployees[0]?.id||"");
      if(!silent)setMessage(realEmployees.length?"":"No Employees have been added yet. Add an Employee before assigning customers.");
    }catch(error){if(!silent)setMessage(error instanceof Error?error.message:"Routes could not be loaded.")}
  }

  useEffect(()=>{const requested=searchParams.get("tab");if(["view","build","smart","move"].includes(requested||""))setMode(requested as Mode)},[searchParams]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(true),3000);return()=>window.clearInterval(timer)},[]);

  const employee=employees.find(item=>item.id===employeeId)||null,targetEmployee=employees.find(item=>item.id===targetEmployeeId)||null;
  const jobs=useMemo(()=>leads.filter(item=>!item.canonicalVisitId),[leads]);
  const available=useMemo(()=>jobs.filter(item=>!item.assignedCrew),[jobs]);
  const assigned=useMemo(()=>jobs.filter(item=>Boolean(item.assignedCrew)),[jobs]);
  const employeeCustomers=useMemo(()=>employee?assigned.filter(item=>item.assignedCrew===employee.name).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)):[],[assigned,employee]);
  const employeeDayRoute=useMemo(()=>employeeCustomers.filter(item=>!item.scheduledDate||item.scheduledDate===date),[employeeCustomers,date]);
  const normalized=query.trim().toLowerCase();
  const filter=(items:Lead[])=>items.filter(item=>!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized));
  const buildAvailable=useMemo(()=>filter(available).sort((a,b)=>a.address.localeCompare(b.address)),[available,normalized]);
  const smartCandidates=useMemo(()=>filter(employeeCustomers),[employeeCustomers,normalized]);
  const moveCandidates=useMemo(()=>filter(employeeCustomers.filter(item=>!item.scheduledDate||item.scheduledDate===date)),[employeeCustomers,date,normalized]);
  const selectedJobs=jobs.filter(item=>selected.includes(item.id));
  const buildMapHomes=useMemo(()=>[...employeeCustomers.map(item=>({...item,status:"completed" as const})),...available],[employeeCustomers,available]);

  function changeMode(next:Mode){setMode(next);setSelected([]);setQuery("");setPropertyPreview(null);setSmartPreview([]);setOrigin(null);window.history.replaceState(null,"",`/admin/routes?tab=${next}`)}
  function toggle(id:string){setSmartPreview([]);setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}
  function selectVisible(items:Lead[]){setSmartPreview([]);const ids=items.map(item=>item.id);setSelected(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])])}

  async function post(body:Record<string,unknown>){const token=await accessToken();const response=await fetch("/api/admin/routes",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"The route change could not be saved.");return result}

  async function assignSelected(){if(!employee||!selectedJobs.length)return;const ids=new Set(selectedJobs.map(x=>x.id));setLeads(current=>current.map(x=>ids.has(x.id)?{...x,assignedCrew:employee.name}:x));setSelected([]);setBusy(true);try{const result=await post({action:"assign",jobIds:selectedJobs.map(x=>x.canonicalJobId||x.id),crewId:employee.crewId});setMessage(`${result.count} customer${result.count===1?"":"s"} assigned to ${employee.name}.`);await refresh(true)}catch(error){setMessage(error instanceof Error?error.message:"Assignment failed.");await refresh(true)}finally{setBusy(false)}}

  async function returnToAvailable(home:Lead){if(!window.confirm(`Return ${home.name} to available customers?`))return;setPropertyPreview(null);setLeads(current=>current.map(x=>x.id===home.id?{...x,assignedCrew:undefined,scheduledDate:undefined,routeOrder:undefined}:x));setBusy(true);try{await post({action:"unassign",jobIds:[home.canonicalJobId||home.id]});setMessage(`${home.name} returned to available customers.`);await refresh(true)}catch(error){setMessage(error instanceof Error?error.message:"Customer could not be returned.");await refresh(true)}finally{setBusy(false)}}

  async function geocode(address:string){const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`,{cache:"no-store"});if(!response.ok)throw new Error(`Address could not be mapped: ${address}`);return await response.json() as {latitude:number;longitude:number}}

  async function generatePreview(){
    if(!employee||!selectedJobs.length){setMessage("Select an Employee and at least one assigned customer.");return}
    const startAddress=startMode==="employee"?employee.routeStartAddress:manualStartAddress.trim();if(!startAddress){setMessage("Choose a valid starting address.");return}
    setPreviewBusy(true);setMessage("Mapping properties and optimizing the driving order...");
    try{const start=await geocode(startAddress);const mapped=await Promise.all(selectedJobs.map(async home=>Number.isFinite(home.latitude)&&Number.isFinite(home.longitude)?home:{...home,...await geocode(home.address)}));
      let ordered=[...mapped];if(mapped.length>1){const response=await fetch("/api/map/optimize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({start:[start.longitude,start.latitude],coordinates:mapped.map(home=>[Number(home.longitude),Number(home.latitude)])})});if(response.ok){const result=await response.json() as {order:number[]};ordered=result.order.map(index=>mapped[index]).filter(Boolean)}}
      setOrigin({latitude:start.latitude,longitude:start.longitude,label:startMode==="employee"?`${employee.name} start`:"Manual route start"});setSmartPreview(ordered);setMessage("Preview ready. Review the numbered route and confirm publication.");
    }catch(error){setMessage(error instanceof Error?error.message:"Smart Route preview failed.")}finally{setPreviewBusy(false)}
  }

  async function publishSmart(){if(!employee||!smartPreview.length)return;setBusy(true);try{const result=await post({action:"smart",jobIds:smartPreview.map(x=>x.canonicalJobId||x.id),crewId:employee.crewId,routeDate:date});setMessage(`Smart Route published for ${employee.name} with ${result.count} stops.`);setSelected([]);setSmartPreview([]);await refresh(true);changeMode("view")}catch(error){setMessage(error instanceof Error?error.message:"Smart Route could not be published.")}finally{setBusy(false)}}

  async function moveSelected(){if(!targetEmployee||!selectedJobs.length)return;setBusy(true);try{const result=await post({action:"move",jobIds:selectedJobs.map(x=>x.canonicalJobId||x.id),crewId:targetEmployee.crewId,routeDate:targetDate});setMessage(`${result.count} houses moved to ${targetEmployee.name}.`);setSelected([]);await refresh(true);changeMode("view")}catch(error){setMessage(error instanceof Error?error.message:"Move failed.")}finally{setBusy(false)}}

  const title=mode==="build"?"Assign customers to an Employee.":mode==="smart"?"Build the daily Smart Route.":mode==="move"?"Move houses between Employees.":employee?`${employeeDayRoute.length} stops for ${employee.name}.`:"Select an Employee.";

  return <section className="desktop-route-studio">
    <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{title}</h1><p>One synchronized workspace for assignments, route planning and Employee delivery.</p></div><div className="desktop-route-actions"><button className="btn btn-outline" onClick={()=>void refresh()} disabled={busy}>Refresh</button>{employee&&<Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(employee.name)}&date=${encodeURIComponent(date)}`}>Employee View</Link>}</div></header>
    <nav className="desktop-route-modes"><button className={mode==="view"?"active":""} onClick={()=>changeMode("view")}>View</button><button className={mode==="build"?"active":""} onClick={()=>changeMode("build")}>Build</button><button className={mode==="smart"?"active":""} onClick={()=>changeMode("smart")}>Smart Route</button><button className={mode==="move"?"active":""} onClick={()=>changeMode("move")}>Move</button></nav>

    {mode!=="move"&&<section className="desktop-route-controls route-controls-dynamic"><label><span>Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([]);setSmartPreview([])}}>{employees.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{mode!=="build"&&<label><span>Day</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSmartPreview([])}}/></label>}<label className="route-search"><span>Search customers</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, address, city or service"/></label></section>}
    {message&&<div className="desktop-route-message">{message}</div>}

    {mode==="view"&&<section className="desktop-route-workspace"><MapCard title="Route Map" count={employeeDayRoute.length}><EmployeeRouteMap route={employeeDayRoute} desktop actionLabel="Property profile" onOpenVisit={setPropertyPreview}/></MapCard><RouteList items={employeeDayRoute} selected={selected} onClick={setPropertyPreview} empty="No stops for this date."/></section>}

    {mode==="build"&&<section className="desktop-route-workspace"><MapCard title="Assigned and available properties" count={buildMapHomes.length}><EmployeeRouteMap route={buildMapHomes} desktop actionLabel="Property profile" onOpenVisit={home=>home.assignedCrew?setPropertyPreview(home):toggle(home.id)}/><div className="route-map-legend"><span><i className="green"/>Assigned</span><span><i className="blue"/>Available</span></div></MapCard><aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{buildAvailable.length} available</span></div><button className="btn btn-outline route-select-all" onClick={()=>selectVisible(buildAvailable)}>Select visible</button><RouteButtons items={buildAvailable} selected={selected} onClick={home=>toggle(home.id)} label="Available"/><div className="desktop-route-build-box"><small>Assign customers only. The daily order is created in Smart Route.</small><button className="btn btn-primary" disabled={busy||!selected.length} onClick={()=>void assignSelected()}>{busy?"Assigning...":`Assign ${selected.length} customers`}</button></div></aside></section>}

    {mode==="smart"&&<><section className="smart-route-start-card"><div><span>Route start</span><strong>Choose the route origin</strong></div><label className={startMode==="employee"?"selected":""}><input type="radio" checked={startMode==="employee"} onChange={()=>{setStartMode("employee");setSmartPreview([])}}/><span><b>Employee default address</b><small>{employee?.routeStartAddress||"No default address saved"}</small></span></label><label className={startMode==="manual"?"selected":""}><input type="radio" checked={startMode==="manual"} onChange={()=>{setStartMode("manual");setSmartPreview([])}}/><span><b>Manual starting address</b><small>Use another origin for this route</small></span></label>{startMode==="manual"&&<AddressAutocomplete value={manualStartAddress} onChange={value=>{setManualStartAddress(value);setSmartPreview([])}} placeholder="Enter route starting address" ariaLabel="Manual route starting address"/>}</section><section className="desktop-route-workspace"><MapCard title={smartPreview.length?"Optimized route preview":"Assigned customer map"} count={(smartPreview.length?smartPreview:smartCandidates).length}><EmployeeRouteMap route={smartPreview.length?smartPreview:smartCandidates} originPoint={origin} desktop actionLabel="Property profile" onOpenVisit={setPropertyPreview}/></MapCard><aside className="desktop-route-side"><div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>{date}</span></div><button className="btn btn-outline route-select-all" onClick={()=>selectVisible(smartCandidates)}>Select assigned customers</button><RouteButtons items={smartPreview.length?smartPreview:smartCandidates} selected={selected} onClick={home=>toggle(home.id)} label="Assigned"/><div className="desktop-route-build-box">{!smartPreview.length?<button className="btn btn-primary" disabled={previewBusy||!selected.length} onClick={()=>void generatePreview()}>{previewBusy?"Optimizing...":`Generate Preview (${selected.length})`}</button>:<><small>Review the origin, numbered stops and driving line before publishing.</small><button className="btn btn-primary" disabled={busy} onClick={()=>void publishSmart()}>{busy?"Publishing...":`Confirm & Publish (${smartPreview.length})`}</button></>}</div></aside></section></>}

    {mode==="move"&&<section className="route-move-panel"><div className="route-move-row"><label><span>Remove from Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}}>{employees.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>Current date</span><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label></div><RouteButtons items={moveCandidates} selected={selected} onClick={home=>toggle(home.id)} label={employee?.name||"Assigned"}/><div className="route-move-divider">Move selected houses to</div><div className="route-move-row"><label><span>Destination Employee</span><select value={targetEmployeeId} onChange={event=>setTargetEmployeeId(event.target.value)}>{employees.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>New date</span><input type="date" value={targetDate} onChange={event=>setTargetDate(event.target.value)}/></label></div><button className="btn btn-primary route-move-submit" disabled={busy||!selected.length} onClick={()=>void moveSelected()}>{busy?"Moving...":`Move ${selected.length} selected houses`}</button></section>}

    <CustomerPropertyModal property={propertyPreview} onClose={()=>setPropertyPreview(null)} onReturnToAvailable={returnToAvailable} busy={busy}/>
    <style jsx global>{`.route-controls-dynamic{grid-template-columns:repeat(3,minmax(180px,1fr))}.desktop-route-controls .route-search input{width:100%}.route-select-all{margin:14px 14px 0;width:calc(100% - 28px)}.route-map-legend{display:flex;gap:18px;padding:12px 16px;border-top:1px solid #e3ece7}.route-map-legend span{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12px}.route-map-legend i{width:12px;height:12px;border-radius:50%}.route-map-legend .green{background:#16a34a}.route-map-legend .blue{background:#2563eb}.smart-route-start-card{display:grid;grid-template-columns:minmax(220px,1fr) repeat(2,minmax(220px,1fr));gap:12px;margin-top:18px;padding:18px;border:1px solid #dbe7e1;border-radius:20px;background:#fff}.smart-route-start-card>div{display:grid;align-content:center}.smart-route-start-card label{display:flex;gap:10px;align-items:center;padding:13px;border:1px solid #d8e5df;border-radius:14px}.smart-route-start-card label.selected{border-color:#0b7655;background:#eef8f3}.smart-route-start-card label span{display:grid}.route-move-panel{display:grid;gap:18px;margin-top:18px;padding:22px;border:1px solid #dbe7e1;border-radius:22px;background:#fff}.route-move-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.route-move-row label{display:grid;gap:7px}.route-move-row select,.route-move-row input{min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px}.route-move-divider{text-align:center;font-weight:900;color:#0b684c;padding:12px;border-block:1px solid #e4ece8}.route-move-submit{width:100%}@media(max-width:900px){.route-controls-dynamic,.route-move-row,.smart-route-start-card{grid-template-columns:1fr}.desktop-route-workspace{grid-template-columns:1fr}}`}</style>
  </section>
}

function MapCard({title,count,children}:{title:string;count:number;children:React.ReactNode}){return <article className="desktop-route-map-card"><div className="desktop-route-map-head"><div><strong>{title}</strong><span>{count} properties</span></div></div>{children}</article>}
function RouteList({items,onClick,empty}:{items:Lead[];selected:string[];onClick:(home:Lead)=>void;empty:string}){return <aside className="desktop-route-side"><div className="desktop-route-list">{items.map((home,index)=><button key={home.id} onClick={()=>onClick(home)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service}</small></div><i className="done">Assigned</i></button>)}{!items.length&&<div className="desktop-route-empty"><strong>{empty}</strong></div>}</div></aside>}
function RouteButtons({items,selected,onClick,label}:{items:Lead[];selected:string[];onClick:(home:Lead)=>void;label:string}){return <div className="desktop-route-list">{items.map((home,index)=><button key={home.id} className={selected.includes(home.id)?"selected":""} onClick={()=>onClick(home)}><b>{index+1}</b><div><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service}</small></div><i className={home.assignedCrew?"done":""}>{label}</i></button>)}{!items.length&&<div className="desktop-route-empty"><strong>No matching properties.</strong></div>}</div>}
