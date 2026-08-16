"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OfficialRoutePlanMap } from "@/components/admin/OfficialRoutePlanMap";
import { RouteAdvisorWorkspace } from "@/components/admin/RouteAdvisorWorkspace";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { canonicalRouteLeadsForEmployee, canonicalRouteWarnings } from "@/lib/routes/canonicalRouteIdentity";
import { haversineKm } from "@/lib/routes/routeAdvisor";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = { id:string; employeeId:string|null; crewId:string; employeeIds?:string[]; crewIds?:string[]; name:string; email:string; routeStartAddress:string|null; dailyCapacity?:number };
type Mode = "view" | "build" | "advisor" | "move";
type MoveMode = "temporary" | "permanent";
type Fit = "Best fit" | "Good fit" | "Possible" | "Not ideal";
type OwnerRecommendation = { employee:RouteEmployee; fit:Fit; avgKm:number|null; assigned:number; reasons:string[]; days:string[] };

function jobId(home: RouteLead){ return home.canonicalJobId || home.id; }
function firstName(name:string){ return name.trim().split(/\s+/)[0] || name; }
function frequencyWeight(value?:string){ const v=String(value||"one_time").toLowerCase(); return v==="weekly"?1:v==="biweekly"||v==="bi_weekly"?0.5:v==="monthly"?0.25:0.08; }
function frequencyLabel(value?:string){ const v=String(value||"one_time").toLowerCase(); return v==="weekly"?"Weekly":v==="biweekly"||v==="bi_weekly"?"Biweekly":v==="monthly"?"Monthly":"One-time"; }
async function accessToken(){ const client=getSupabaseBrowserClient() as any; const {data}=await client.auth.getSession(); const token=data.session?.access_token; if(!token) throw new Error("Your Admin session expired. Sign in again."); return token; }
async function geocode(address:string){ const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`,{cache:"no-store"}); if(!response.ok) throw new Error(`Address could not be mapped: ${address}`); return response.json() as Promise<{latitude:number;longitude:number}>; }
function likelyDays(homes:RouteLead[]){ const counts=new Map<string,number>(); for(const home of homes){ const date=home.nextVisitDate||home.scheduledDate; if(!date) continue; const [y,m,d]=date.split("-").map(Number); const day=new Intl.DateTimeFormat("en-CA",{weekday:"short",timeZone:"America/Toronto"}).format(new Date(Date.UTC(y,m-1,d,17))); counts.set(day,(counts.get(day)||0)+1); } return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([day])=>day); }

export function RouteStudioV2(){
  const searchParams=useSearchParams();
  const [mode,setMode]=useState<Mode>("view");
  const [moveMode,setMoveMode]=useState<MoveMode>("temporary");
  const [date,setDate]=useState(operationalDateKey());
  const [employees,setEmployees]=useState<RouteEmployee[]>([]);
  const [leads,setLeads]=useState<RouteLead[]>([]);
  const [employeeId,setEmployeeId]=useState("");
  const [targetEmployeeId,setTargetEmployeeId]=useState("");
  const [selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState("");
  const [message,setMessage]=useState("Loading routes...");
  const [busy,setBusy]=useState(false);
  const [recommendations,setRecommendations]=useState<OwnerRecommendation[]>([]);

  async function refresh(silent=false){
    try{
      const token=await accessToken();
      const [routeResponse,userResponse]=await Promise.all([
        fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
        fetch("/api/admin/users",{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
      ]);
      const result=await routeResponse.json(); const userResult=await userResponse.json().catch(()=>({users:[]}));
      if(!routeResponse.ok) throw new Error(result.error||"Routes could not be loaded.");
      const capacities=new Map<string,number>((userResult.users||[]).map((item:any)=>[String(item.id),Math.max(1,Number(item.daily_route_capacity||16))]));
      const realEmployees:RouteEmployee[]=(result.employees||[]).map((item:RouteEmployee)=>({...item,dailyCapacity:capacities.get(item.id)||16}));
      const mapped=schedulingBoardToLeads((result.board||{}) as SchedulingDispatchBoard);
      const warnings=canonicalRouteWarnings(mapped);
      setEmployees(realEmployees); setLeads(mapped);
      setEmployeeId(current=>realEmployees.some(item=>item.id===current)?current:realEmployees[0]?.id||"");
      setTargetEmployeeId(current=>realEmployees.some(item=>item.id===current)?current:realEmployees.find(item=>item.id!==realEmployees[0]?.id)?.id||realEmployees[0]?.id||"");
      if(!silent){ if(!realEmployees.length)setMessage("No active Employees found."); else if(warnings.length)setMessage(`${warnings.length} published route stop${warnings.length===1?"":"s"} need canonical ID repair.`); else setMessage(""); }
    }catch(error){ if(!silent)setMessage(error instanceof Error?error.message:"Routes could not be loaded."); }
  }

  useEffect(()=>{ const requested=searchParams.get("tab"); if(["view","build","advisor","move"].includes(requested||"")) setMode(requested as Mode); },[searchParams]);
  useEffect(()=>{ void refresh(); const timer=window.setInterval(()=>void refresh(true),10_000); return()=>window.clearInterval(timer); },[date]);

  const jobs=useMemo(()=>leads.filter(item=>!item.canonicalVisitId),[leads]);
  const visits=useMemo(()=>leads.filter(item=>Boolean(item.canonicalVisitId)),[leads]);
  const sourceEmployee=employees.find(item=>item.id===employeeId)||null;
  const targetEmployee=employees.find(item=>item.id===targetEmployeeId)||null;
  const normalized=query.trim().toLowerCase();
  const visibleJobs=useMemo(()=>jobs.filter(item=>!normalized||`${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalized)),[jobs,normalized]);
  const sourceIdentity=sourceEmployee?{id:sourceEmployee.employeeId||sourceEmployee.id,crewId:sourceEmployee.crewId,employeeIds:sourceEmployee.employeeIds,crewIds:sourceEmployee.crewIds}:null;
  const sourceRoute=useMemo(()=>sourceIdentity?canonicalRouteLeadsForEmployee(visits.filter(item=>item.scheduledDate===date),sourceIdentity).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)):[],[visits,date,sourceIdentity?.id,sourceIdentity?.crewId]);
  const movableSource=useMemo(()=>sourceRoute.filter(item=>(item.canonicalVisitStatus||item.status)==="scheduled"),[sourceRoute]);
  const selectedHomes=useMemo(()=>{const ids=new Set(selected); return jobs.filter(item=>ids.has(jobId(item)));},[jobs,selected]);

  function changeMode(next:Mode){ setMode(next); setSelected([]); setQuery(""); setMessage(""); setRecommendations([]); window.history.replaceState(null,"",`/admin/routes?tab=${next}`); }
  function toggle(id:string){ setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]); setRecommendations([]); }
  function selectVisible(items:RouteLead[]){ const ids=items.map(jobId); setSelected(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])]); setRecommendations([]); }
  async function post(path:string,body:Record<string,unknown>){ const token=await accessToken(); const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)}); const result=await response.json(); if(!response.ok)throw new Error(result.error||"The route change could not be saved."); return result; }

  async function recommendOwner(){
    if(!selectedHomes.length){setMessage("Select at least one Customer Job first.");return;}
    setBusy(true); setMessage("Comparing region, existing ownership, overall capacity and service frequency...");
    try{
      const locatedHomes=await Promise.all(selectedHomes.map(async home=>({home,point:await geocode(home.address).catch(()=>null)})));
      const assignedCounts=new Map(employees.map(worker=>[worker.crewId,jobs.filter(job=>job.canonicalCrewId===worker.crewId).length]));
      const raw=await Promise.all(employees.map(async worker=>{
        const start=worker.routeStartAddress?await geocode(worker.routeStartAddress).catch(()=>null):null;
        const distances=start?locatedHomes.flatMap(item=>item.point?[haversineKm(start,item.point)]:[]):[];
        const avgKm=distances.length?distances.reduce((a,b)=>a+b,0)/distances.length:null;
        const assigned=assignedCounts.get(worker.crewId)||0;
        const weeklyLoad=jobs.filter(job=>job.canonicalCrewId===worker.crewId).reduce((sum,job)=>sum+frequencyWeight(job.serviceFrequency),0);
        const capacity=Math.max(1,(worker.dailyCapacity||16)*5);
        const loadRatio=weeklyLoad/capacity;
        const distancePenalty=avgKm===null?12:Math.min(35,avgKm*2.2);
        const loadPenalty=Math.min(30,loadRatio*45);
        const continuityBonus=selectedHomes.filter(job=>job.canonicalCrewId===worker.crewId).length*8;
        return {worker,avgKm,assigned,rankValue:100-distancePenalty-loadPenalty+continuityBonus};
      }));
      raw.sort((a,b)=>b.rankValue-a.rankValue);
      const ranked:OwnerRecommendation[]=raw.map((item,index)=>{
        const fit:Fit=index===0?"Best fit":index===1?"Good fit":index<=3?"Possible":"Not ideal";
        const reasons=[item.avgKm===null?"Employee start address is not mapped":item.avgKm<=5?"Strong regional proximity":item.avgKm<=15?"Reasonable regional proximity":"Adds more travel",`${item.assigned} Customer Job${item.assigned===1?"":"s"} already owned`,`${item.worker.dailyCapacity||16}/day configured capacity`];
        return {employee:item.worker,fit,avgKm:item.avgKm===null?null:Number(item.avgKm.toFixed(1)),assigned:item.assigned,reasons,days:likelyDays(selectedHomes)};
      });
      setRecommendations(ranked); setMessage("Ownership suggestions are ready. Labels are guidance only; the Admin can choose or change any Employee.");
    }catch(error){setMessage(error instanceof Error?error.message:"Ownership recommendation failed.");}
    finally{setBusy(false);}
  }

  async function assignSelected(){ if(!sourceEmployee||!selected.length)return; setBusy(true); try{ const result=await post("/api/admin/routes",{action:"assign",jobIds:selected,crewId:sourceEmployee.crewId}); setMessage(`${result.count} Customer Job${result.count===1?"":"s"} permanently assigned to ${sourceEmployee.name}. No Visit or route was created.`); setSelected([]); setRecommendations([]); await refresh(true); }catch(error){setMessage(error instanceof Error?error.message:"Assignment failed.");}finally{setBusy(false);} }
  async function moveSelected(){ if(!sourceEmployee||!targetEmployee||!selected.length)return; const selectedSet=new Set(selected); const stops=movableSource.filter(item=>selectedSet.has(jobId(item))); if(!stops.length){setMessage("Only Scheduled Visits can be moved.");return;} const permanent=moveMode==="permanent"; if(!window.confirm(permanent?`Permanently assign ${stops.length} house${stops.length===1?"":"s"} to ${targetEmployee.name}?`:`Temporarily send ${stops.length} house${stops.length===1?"":"s"} to ${targetEmployee.name} for ${date}?`))return; setBusy(true); try{const result=await post("/api/admin/route-assignment",{mode:moveMode,visitIds:stops.map(item=>item.canonicalVisitId||item.id),employeeId:targetEmployee.employeeId||targetEmployee.id,crewId:targetEmployee.crewId}); setMessage(permanent?`${result.jobCount} permanent Job assignment${result.jobCount===1?"":"s"} moved to ${targetEmployee.name}.`:`${result.selectedCount} dated Visit${result.selectedCount===1?"":"s"} temporarily moved to ${targetEmployee.name}.`); setSelected([]); await refresh(true); changeMode("view");}catch(error){setMessage(error instanceof Error?error.message:"Move failed.");}finally{setBusy(false);} }

  const title=mode==="build"?"Choose the best regular Employee for each Customer.":mode==="advisor"?"Build the real daily route, review it, then publish.":mode==="move"?"Move a dated Visit or change ownership permanently.":`${employees.length} active Employee${employees.length===1?"":"s"} on the official Route Plan.`;

  return <section className="desktop-route-studio route-studio-v2">
    <header className="desktop-route-hero"><div><span>Dispatch & Routes</span><h1>{title}</h1><p>Build controls ownership. Route Advisor controls dated routes and recurring route references.</p></div><button className="btn btn-outline" disabled={busy} onClick={()=>void refresh()}>{busy?"Working...":"Refresh"}</button></header>
    <nav className="desktop-route-modes"><button className={mode==="view"?"active":""} onClick={()=>changeMode("view")}>View</button><button className={mode==="build"?"active":""} onClick={()=>changeMode("build")}>Build</button><button className={mode==="advisor"?"active":""} onClick={()=>changeMode("advisor")}>Route Advisor</button><button className={mode==="move"?"active":""} onClick={()=>changeMode("move")}>Move</button></nav>
    {message&&<div className="desktop-route-message">{message}</div>}
    {mode==="view"&&<OfficialRoutePlanMap date={date} onDateChange={setDate}/>} {mode==="advisor"&&<RouteAdvisorWorkspace/>}

    {mode==="build"&&<section className="owner-build">
      <header className="owner-build-head"><div><span>BUILD · PERMANENT OWNER</span><h2>Who should regularly own these customers?</h2><p>Build never creates a Route or Visit. Recommendations use region, current ownership load, capacity and frequency.</p></div><button className="btn btn-primary" disabled={busy||!selectedHomes.length} onClick={()=>void recommendOwner()}>{busy?"Analyzing...":`Recommend owner (${selectedHomes.length})`}</button></header>
      <div className="owner-build-controls"><label><span>Admin choice</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}><option value="">Select Employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Search Customers / houses</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Customer, address or service"/></label></div>
      <div className="owner-build-grid"><aside><div className="owner-list-head"><strong>{selected.length} selected</strong><button type="button" onClick={()=>selectVisible(visibleJobs)}>Select visible</button></div><div className="owner-list">{visibleJobs.map(home=>{const id=jobId(home);const active=selected.includes(id);const currentOwner=employees.find(worker=>worker.crewId===home.canonicalCrewId);return <button type="button" key={id} className={active?"selected":""} onClick={()=>toggle(id)}><b>{active?"✓":"+"}</b><span><strong>{firstName(home.name)} — {home.address}</strong><small>{home.service} · {frequencyLabel(home.serviceFrequency)} · {currentOwner?`Owner: ${currentOwner.name}`:"Unassigned"}</small></span><em>{active?"Selected":currentOwner?"Can reassign":"Choose"}</em></button>})}</div></aside><main>
        {recommendations.length>0?<section className="owner-recommendations"><header><strong>Employee ownership fit</strong><span>No percentages — Admin remains in control.</span></header>{recommendations.map((item,index)=><button type="button" key={item.employee.id} className={sourceEmployee?.id===item.employee.id?"chosen":""} onClick={()=>setEmployeeId(item.employee.id)}><b>{index+1}</b><span><strong>{item.employee.name}</strong><small>{item.avgKm===null?"Distance unavailable":`${item.avgKm} km average from start`} · {item.assigned} owned Jobs{item.days.length?` · likely ${item.days.join(" / ")}`:""}</small><em>{item.reasons.join(" · ")}</em></span><i className={`fit-${item.fit.toLowerCase().replaceAll(" ","-")}`}>{item.fit}</i></button>)}</section>:<section className="owner-empty"><span>SMART OWNERSHIP</span><h3>{sourceEmployee?.name||"Choose an Employee"}</h3><p>Select one or more houses, request a recommendation, or simply choose the Employee yourself. Changing ownership later stays easy.</p></section>}
        <section className="owner-commit"><div><strong>{sourceEmployee?`Regular Employee: ${sourceEmployee.name}`:"Choose the regular Employee"}</strong><span>This changes canonical Job ownership only. No date, route, recurrence or Visit is created here.</span></div><button className="btn btn-primary" disabled={busy||!sourceEmployee||!selected.length} onClick={()=>void assignSelected()}>{busy?"Assigning...":`Save ownership (${selected.length})`}</button></section>
      </main></div>
    </section>}

    {mode==="move"&&<section className="owner-build"><div className="owner-build-controls move-controls"><label><span>From Employee</span><select value={employeeId} onChange={event=>{setEmployeeId(event.target.value);setSelected([])}}><option value="">Select Employee</option>{employees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Visit date</span><input type="date" value={date} onChange={event=>{setDate(event.target.value);setSelected([])}}/></label><label><span>To Employee</span><select value={targetEmployeeId} onChange={event=>setTargetEmployeeId(event.target.value)}><option value="">Select Employee</option>{employees.filter(item=>item.id!==employeeId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="owner-build-grid"><aside><div className="owner-list">{movableSource.map((home,index)=>{const id=jobId(home);const active=selected.includes(id);return <button type="button" key={id} className={active?"selected":""} onClick={()=>toggle(id)}><b>{home.routeOrder||index+1}</b><span><strong>{home.name}</strong><small>{home.address}</small></span><em>{active?"Selected":"Choose"}</em></button>})}</div></aside><main><section className="owner-empty"><span>ASSIGNMENT MODE</span><h3>{targetEmployee?.name||"Choose destination"}</h3><div className="move-mode"><button type="button" className={moveMode==="temporary"?"active":""} onClick={()=>setMoveMode("temporary")}><b>Temporary</b><small>Only this dated Visit</small></button><button type="button" className={moveMode==="permanent"?"active":""} onClick={()=>setMoveMode("permanent")}><b>Permanent</b><small>Job ownership + future Scheduled Visits</small></button></div><button className="btn btn-primary" disabled={busy||!targetEmployee||!selected.length} onClick={()=>void moveSelected()}>{busy?"Moving...":`${moveMode==="temporary"?"Move temporarily":"Move permanently"} (${selected.length})`}</button></section></main></div></section>}

    <style jsx global>{`
      .owner-build{display:grid;gap:14px;margin-top:18px}.owner-build-head{display:flex;justify-content:space-between;align-items:end;gap:18px;padding:20px;border-radius:22px;background:linear-gradient(135deg,#0a3729,#0c6847);color:#fff}.owner-build-head span,.owner-empty>span{font-size:10px;font-weight:950;letter-spacing:.13em;color:#9ce3b9}.owner-build-head h2{margin:5px 0;font-size:28px}.owner-build-head p{margin:0;color:rgba(255,255,255,.7)}.owner-build-controls{display:grid;grid-template-columns:280px 1fr;gap:10px;padding:14px;border:1px solid #dbe7e1;border-radius:18px;background:#fff}.move-controls{grid-template-columns:repeat(3,1fr)}.owner-build-controls label{display:grid;gap:6px}.owner-build-controls label>span{font-size:10px;font-weight:900;color:#607168;text-transform:uppercase}.owner-build-controls input,.owner-build-controls select{min-height:46px;border:1px solid #cbdad2;border-radius:12px;padding:0 12px;background:#fff}.owner-build-grid{display:grid;grid-template-columns:minmax(360px,.8fr) minmax(0,1.2fr);gap:14px}.owner-build-grid>aside,.owner-build-grid>main{border:1px solid #dbe7e1;border-radius:22px;background:#fff;overflow:hidden}.owner-build-grid>main{display:grid;align-content:start;gap:12px;padding:14px}.owner-list-head{display:flex;justify-content:space-between;padding:13px;border-bottom:1px solid #edf2ef}.owner-list-head button{border:0;background:transparent;color:#0b7655;font-weight:800;cursor:pointer}.owner-list{display:grid;gap:6px;max-height:650px;overflow:auto;padding:9px}.owner-list>button,.owner-recommendations>button{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;padding:11px;border:1px solid transparent;border-radius:13px;background:#fff;text-align:left;cursor:pointer}.owner-list>button:hover,.owner-recommendations>button:hover{background:#f5faf7}.owner-list>button.selected,.owner-recommendations>button.chosen{border-color:#0b7655;background:#edf8f2}.owner-list b,.owner-recommendations>button>b{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#eaf2ee;color:#0b684c}.owner-list strong,.owner-list small,.owner-recommendations strong,.owner-recommendations small,.owner-recommendations em{display:block}.owner-list small,.owner-recommendations small,.owner-recommendations em{margin-top:3px;color:#697c72;font-size:11px}.owner-list em{font-style:normal;color:#0b7655;font-size:10px;font-weight:900}.owner-recommendations{display:grid;gap:5px}.owner-recommendations header{display:flex;justify-content:space-between;padding:4px 5px 9px;color:#173a2c}.owner-recommendations header span{color:#718078;font-size:12px}.owner-recommendations em{font-style:normal;line-height:1.4}.owner-recommendations i{font-style:normal;font-size:10px;font-weight:950;padding:6px 8px;border-radius:999px;white-space:nowrap;background:#eef4f1;color:#365b4b}.owner-recommendations .fit-best-fit{background:#dcfce7;color:#166534}.owner-recommendations .fit-good-fit{background:#ecfdf5;color:#047857}.owner-recommendations .fit-possible{background:#fef9c3;color:#854d0e}.owner-recommendations .fit-not-ideal{background:#f1f5f9;color:#64748b}.owner-empty{display:grid;gap:10px;padding:22px;border-radius:17px;background:#103e30;color:#fff}.owner-empty h3{margin:0;font-size:26px}.owner-empty p{margin:0;color:rgba(255,255,255,.7);line-height:1.55}.owner-commit{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px;border-radius:16px;background:#f4f9f6}.owner-commit strong,.owner-commit span{display:block}.owner-commit span{margin-top:3px;color:#718078;font-size:12px}.move-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px}.move-mode button{display:grid;gap:3px;padding:13px;border:1px solid #cfe0d7;border-radius:12px;background:#fff;text-align:left;cursor:pointer}.move-mode button.active{box-shadow:0 0 0 2px #67c18d}.move-mode small{color:#6b7e74}@media(max-width:1000px){.owner-build-head{align-items:stretch;flex-direction:column}.owner-build-controls,.move-controls,.owner-build-grid{grid-template-columns:1fr}.owner-commit{align-items:stretch;flex-direction:column}.owner-commit .btn{width:100%}}@media(max-width:640px){.owner-recommendations>button{grid-template-columns:32px minmax(0,1fr)}.owner-recommendations i{grid-column:2;justify-self:start}}
    `}</style>
  </section>;
}
