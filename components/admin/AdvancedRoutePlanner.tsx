"use client";

import { useEffect, useMemo, useState } from "react";
import { InteractiveRoutePreviewMap, type RoutePreviewMetrics } from "@/components/admin/InteractiveRoutePreviewMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { haversineKm } from "@/lib/routes/routeAdvisor";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type Employee = { id:string; employeeId:string|null; crewId:string; name:string; routeStartAddress:string|null; dailyCapacity:number };
type Point = { latitude:number; longitude:number };
type PlannedDay = { key:string; label:string; date:string; capacity:number; homes:RouteLead[] };

const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function jobId(home:RouteLead){ return home.canonicalJobId || home.id; }
function frequencyLabel(value?:string){ const v=String(value||"one_time").toLowerCase(); return v==="weekly"?"Weekly":v==="biweekly"||v==="bi_weekly"?"Biweekly":v==="monthly"?"Monthly":"One-time"; }
function isRecurring(home:RouteLead){ return frequencyLabel(home.serviceFrequency)!=="One-time"; }
function dateFrom(value:string){ const [y,m,d]=value.split("-").map(Number); return new Date(Date.UTC(y,m-1,d,17)); }
function keyFrom(date:Date){ return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`; }
function mondayOf(value:string){ const date=dateFrom(value); const day=date.getUTCDay(); const offset=day===0?-6:1-day; date.setUTCDate(date.getUTCDate()+offset); return keyFrom(date); }
function addDays(value:string,days:number){ const date=dateFrom(value); date.setUTCDate(date.getUTCDate()+days); return keyFrom(date); }
function weekdayIndex(value?:string){ if(!value)return null; const day=dateFrom(value).getUTCDay(); return day===0?6:day-1; }
function pointOf(home:RouteLead):Point|null{ return Number.isFinite(home.latitude)&&Number.isFinite(home.longitude)?{latitude:Number(home.latitude),longitude:Number(home.longitude)}:null; }
function validServicePoint(point:Point){ return point.latitude>42.5&&point.latitude<44.2&&point.longitude>-81.2&&point.longitude<-78.7; }
function normalizeOrder(homes:RouteLead[]){ return homes.map((home,index)=>({...home,routeOrder:index+1})); }
function centroid(homes:RouteLead[],fallback:Point){ const points=homes.map(pointOf).filter((point):point is Point=>Boolean(point)); if(!points.length)return fallback; return {latitude:points.reduce((sum,p)=>sum+p.latitude,0)/points.length,longitude:points.reduce((sum,p)=>sum+p.longitude,0)/points.length}; }

async function accessToken(){ const client=getSupabaseBrowserClient() as any; const {data}=await client.auth.getSession(); const token=data.session?.access_token; if(!token)throw new Error("Your Admin session expired. Sign in again."); return token; }
async function geocode(address:string){ const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`,{cache:"no-store"}); const result=await response.json().catch(()=>({})); if(!response.ok)throw new Error(result.error||`Address could not be mapped: ${address}`); const point={latitude:Number(result.latitude),longitude:Number(result.longitude)}; if(!validServicePoint(point))throw new Error(`Address resolved outside the operating area: ${address}`); return point; }
async function optimize(start:Point,homes:RouteLead[]){ if(homes.length<2)return normalizeOrder(homes); const coordinates=homes.map(pointOf); if(coordinates.some(point=>!point))return normalizeOrder(homes); const response=await fetch("/api/map/optimize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({start:[start.longitude,start.latitude],coordinates:(coordinates as Point[]).map(point=>[point.longitude,point.latitude])})}); if(!response.ok)return normalizeOrder(homes); const result=await response.json() as {order?:number[]}; if(!Array.isArray(result.order)||result.order.length!==homes.length)return normalizeOrder(homes); return normalizeOrder(result.order.map(index=>homes[index]).filter(Boolean)); }

export function AdvancedRoutePlanner(){
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [jobs,setJobs]=useState<RouteLead[]>([]);
  const [employeeId,setEmployeeId]=useState("");
  const [weekStart,setWeekStart]=useState(mondayOf(operationalDateKey()));
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [showCustomers,setShowCustomers]=useState(false);
  const [caps,setCaps]=useState<number[]>([16,16,16,16,16,0,0]);
  const [plan,setPlan]=useState<PlannedDay[]>([]);
  const [previewDate,setPreviewDate]=useState("");
  const [origin,setOrigin]=useState<(Point&{label:string})|null>(null);
  const [metrics,setMetrics]=useState<RoutePreviewMetrics>({distanceMeters:null,durationSeconds:null});
  const [applyRecurrence,setApplyRecurrence]=useState(true);
  const [horizonWeeks,setHorizonWeeks]=useState(12);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function refresh(){
    try{
      const token=await accessToken();
      const [routesResponse,usersResponse]=await Promise.all([
        fetch(`/api/admin/routes?date=${encodeURIComponent(weekStart)}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
        fetch("/api/admin/users",{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
      ]);
      const result=await routesResponse.json(); const users=await usersResponse.json().catch(()=>({users:[]}));
      if(!routesResponse.ok)throw new Error(result.error||"Planning data could not be loaded.");
      const capacities=new Map<string,number>((users.users||[]).map((row:any)=>[String(row.id),Math.max(1,Number(row.daily_route_capacity||16))]));
      const realEmployees:Employee[]=(result.employees||[]).map((row:any)=>({...row,dailyCapacity:capacities.get(String(row.id))||16}));
      const leads=schedulingBoardToLeads((result.board||{}) as SchedulingDispatchBoard).filter(item=>!item.canonicalVisitId);
      setEmployees(realEmployees); setJobs(leads);
      setEmployeeId(current=>realEmployees.some(worker=>worker.id===current)?current:realEmployees[0]?.id||"");
    }catch(error){setMessage(error instanceof Error?error.message:"Planning data could not be loaded.");}
  }

  useEffect(()=>{ void refresh(); },[weekStart]);
  const employee=employees.find(worker=>worker.id===employeeId)||null;
  const ownedJobs=useMemo(()=>employee?jobs.filter(job=>job.canonicalCrewId===employee.crewId):[],[jobs,employee?.crewId]);
  const selectedJobs=useMemo(()=>{const set=new Set(selectedIds);return ownedJobs.filter(job=>set.has(jobId(job)));},[ownedJobs,selectedIds]);

  useEffect(()=>{
    if(!employee)return;
    setSelectedIds(ownedJobs.map(jobId));
    setCaps([employee.dailyCapacity,employee.dailyCapacity,employee.dailyCapacity,employee.dailyCapacity,employee.dailyCapacity,0,0]);
    setPlan([]); setPreviewDate(""); setOrigin(null); setMessage("");
  },[employee?.id,ownedJobs.length]);

  const capacityTotal=caps.reduce((sum,value)=>sum+Math.max(0,value),0);
  const previewDay=plan.find(day=>day.date===previewDate)||plan.find(day=>day.homes.length)||null;
  const recurringCount=selectedJobs.filter(isRecurring).length;

  function toggleCustomer(id:string){ setSelectedIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]); setPlan([]); }
  function changeCapacity(index:number,value:number){ setCaps(current=>current.map((item,i)=>i===index?Math.max(0,Math.min(99,Math.trunc(value||0))):item)); setPlan([]); }

  async function prepareMappedJobs(){
    if(!employee)throw new Error("Choose an Employee.");
    if(!employee.routeStartAddress)throw new Error("Save a route start address in this Employee profile before using Advanced Planning.");
    const start=await geocode(employee.routeStartAddress);
    const mapped=await Promise.all(selectedJobs.map(async home=>{
      const existing=pointOf(home);
      const point=existing&&validServicePoint(existing)?existing:await geocode(home.address);
      return {...home,latitude:point.latitude,longitude:point.longitude};
    }));
    return {start,mapped};
  }

  async function generateDistribution(){
    if(!employee||!selectedJobs.length){setMessage("Choose an Employee and at least one owned Customer Job.");return;}
    if(capacityTotal<selectedJobs.length){setMessage(`Weekly capacity is ${capacityTotal}, but ${selectedJobs.length} houses are selected. Increase one or more days.`);return;}
    setBusy(true); setMessage("Mapping houses and balancing the week by proximity, due day and available capacity...");
    try{
      const {start,mapped}=await prepareMappedJobs();
      const days:PlannedDay[]=DAY_LABELS.map((label,index)=>({key:label,label,date:addDays(weekStart,index),capacity:caps[index],homes:[]}));
      const ordered=[...mapped].sort((a,b)=>(a.nextVisitDate||"9999").localeCompare(b.nextVisitDate||"9999")||a.address.localeCompare(b.address));
      for(const home of ordered){
        const due=weekdayIndex(home.nextVisitDate||home.scheduledDate);
        const point=pointOf(home)!;
        const available=days.filter(day=>day.capacity>day.homes.length);
        if(!available.length)throw new Error("No remaining day capacity is available for all selected houses.");
        let best=available[0]; let bestScore=Number.POSITIVE_INFINITY;
        for(const day of available){
          const index=DAY_LABELS.indexOf(day.label);
          const center=centroid(day.homes,start);
          const distance=haversineKm(center,point);
          const duePenalty=due===null?0:Math.abs(index-due)*7;
          const loadPenalty=day.capacity?day.homes.length/day.capacity*8:100;
          const score=distance+duePenalty+loadPenalty;
          if(score<bestScore){bestScore=score;best=day;}
        }
        best.homes.push(home);
      }
      for(const day of days){ day.homes=await optimize(start,day.homes); }
      setPlan(days); setOrigin({...start,label:`${employee.name} start`}); setPreviewDate(days.find(day=>day.homes.length)?.date||"");
      setMessage("Week distributed and Smart Route order calculated for every active day. Review the preview, move houses between days if needed, then publish the reviewed week.");
    }catch(error){setMessage(error instanceof Error?error.message:"Advanced planning failed.");}
    finally{setBusy(false);}
  }

  function moveHouse(home:RouteLead,targetDate:string){
    setPlan(current=>{
      const target=current.find(day=>day.date===targetDate); if(!target)return current;
      if(!target.homes.some(item=>jobId(item)===jobId(home))&&target.homes.length>=target.capacity){setMessage(`${target.label} is already at its configured limit.`);return current;}
      return current.map(day=>{
        const without=day.homes.filter(item=>jobId(item)!==jobId(home));
        if(day.date!==targetDate)return {...day,homes:normalizeOrder(without)};
        return {...day,homes:normalizeOrder([...without,home])};
      });
    });
  }

  async function reoptimize(){
    if(!origin||!plan.length)return;
    setBusy(true); setMessage("Recalculating Smart Route order after your manual day changes...");
    try{ const next=[] as PlannedDay[]; for(const day of plan)next.push({...day,homes:await optimize(origin,day.homes)}); setPlan(next); setMessage("Smart Route order recalculated. Review the selected day preview before publishing."); }
    catch(error){setMessage(error instanceof Error?error.message:"Smart Route optimization failed.");}
    finally{setBusy(false);}
  }

  async function publishWeek(){
    if(!employee||!origin||!plan.some(day=>day.homes.length))return;
    const activeDays=plan.filter(day=>day.homes.length);
    if(!window.confirm(`Publish ${activeDays.length} reviewed route${activeDays.length===1?"":"s"} for ${employee.name}? Existing Scheduled membership on those dates may be replaced by this reviewed plan.`))return;
    setBusy(true); setMessage("Publishing reviewed Smart Routes...");
    try{
      const token=await accessToken(); let published=0; let recurrenceVisits=0;
      for(const day of activeDays){
        const response=await fetch("/api/admin/route-advisor",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({action:"publish",employeeId:employee.employeeId||employee.id,crewId:employee.crewId,routeDate:day.date,orderedJobIds:day.homes.map(jobId),sourceVisitIds:[],origin})});
        const result=await response.json(); if(!response.ok)throw new Error(result.error||`Could not publish ${day.label}.`); published+=1;
        if(applyRecurrence&&day.homes.some(isRecurring)){
          const recurring=await fetch("/api/admin/route-recurring-reference",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({employeeId:employee.employeeId||employee.id,crewId:employee.crewId,routeDate:day.date,horizonWeeks,origin})});
          const recurringResult=await recurring.json(); if(!recurring.ok)throw new Error(recurringResult.error||`Recurring pattern failed for ${day.label}.`); recurrenceVisits+=Number(recurringResult.createdVisits||0);
        }
      }
      setMessage(`${published} reviewed route${published===1?"":"s"} published.${applyRecurrence?` ${recurrenceVisits} future Visit${recurrenceVisits===1?"":"s"} materialized from each Job's own frequency.`:" Recurrence was left off."}`);
      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated"));
      await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Publishing the reviewed week failed.");}
    finally{setBusy(false);}
  }

  return <section className="advanced-planner-v3">
    <header className="planner-hero"><div><span>ADVANCED ROUTE PLANNING</span><h2>Distribute the employee's customers first. Smart Route comes next.</h2><p>Set each day's limit, let the system group nearby houses, correct any day manually, then review the optimized route before publishing.</p></div><button className="btn btn-outline" onClick={()=>setShowCustomers(current=>!current)}>{showCustomers?"Hide customers":`Show all customers (${ownedJobs.length})`}</button></header>
    <div className="planner-controls"><label><span>Employee</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}><option value="">Select Employee</option>{employees.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><label><span>Week starting</span><input type="date" value={weekStart} onChange={event=>setWeekStart(mondayOf(event.target.value))}/></label><div className="planner-summary"><b>{selectedJobs.length}</b><span>selected of {ownedJobs.length} owned houses</span></div></div>

    {showCustomers&&<div className="planner-customers"><div className="planner-customer-actions"><button type="button" onClick={()=>setSelectedIds(ownedJobs.map(jobId))}>Select all</button><button type="button" onClick={()=>setSelectedIds([])}>Clear</button></div>{ownedJobs.map(home=>{const id=jobId(home);const active=selectedIds.includes(id);return <button type="button" key={id} className={active?"active":""} onClick={()=>toggleCustomer(id)}><b>{active?"✓":"+"}</b><span><strong>{home.name}</strong><small>{home.address} · {frequencyLabel(home.serviceFrequency)}</small></span></button>})}</div>}

    <div className="planner-capacities">{DAY_LABELS.map((day,index)=><label key={day}><span>{day}</span><input type="number" min={0} max={99} value={caps[index]} onChange={event=>changeCapacity(index,Number(event.target.value))}/><small>{plan[index]?.homes.length||0} planned</small></label>)}</div>
    <div className="planner-actions"><div><strong>{capacityTotal} weekly slots</strong><span>{recurringCount} recurring · {selectedJobs.length-recurringCount} one-time</span></div><button className="btn btn-primary" disabled={busy||!employee||!selectedJobs.length} onClick={()=>void generateDistribution()}>{busy?"Planning...":"Generate week + Smart Routes"}</button></div>

    {plan.length>0&&<>
      <div className="planner-days">{plan.map(day=><button type="button" key={day.date} className={previewDay?.date===day.date?"active":""} onClick={()=>setPreviewDate(day.date)}><strong>{day.homes.length}/{day.capacity}</strong><span>{day.label}</span><small>{day.date}</small></button>)}</div>
      {previewDay&&<section className="planner-preview"><header><div><span>SMART ROUTE PREVIEW</span><h3>{previewDay.label} · {previewDay.date}</h3><p>Order is optimized from {origin?.label||"the Employee start"}. Change a house's day below, then recalculate before publishing.</p></div><button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void reoptimize()}>Recalculate Smart Routes</button></header><div className="planner-stop-list">{previewDay.homes.map((home,index)=><article key={jobId(home)}><b>{index+1}</b><span><strong>{home.name}</strong><small>{home.address} · {frequencyLabel(home.serviceFrequency)}</small></span><select value={previewDay.date} onChange={event=>moveHouse(home,event.target.value)}>{plan.filter(day=>day.capacity>0).map(day=><option key={day.date} value={day.date}>{day.label} · {day.homes.length}/{day.capacity}</option>)}</select></article>)}</div><InteractiveRoutePreviewMap route={previewDay.homes} origin={origin} capacity={previewDay.capacity} onRemove={home=>moveHouse(home,plan.find(day=>day.date!==previewDay.date&&day.capacity>day.homes.length)?.date||previewDay.date)} onMetricsChange={setMetrics}/><div className="planner-metrics"><div><span>Road distance</span><strong>{metrics.distanceMeters===null?"—":`${(metrics.distanceMeters/1000).toFixed(1)} km`}</strong></div><div><span>Driving estimate</span><strong>{metrics.durationSeconds===null?"—":`${Math.max(1,Math.round(metrics.durationSeconds/60))} min`}</strong></div></div></section>}
      <section className="planner-publish"><div className="planner-recurrence"><label><input type="checkbox" checked={applyRecurrence} onChange={event=>setApplyRecurrence(event.target.checked)}/><span><strong>Repeat routes using each house's real frequency</strong><small>Weekly stays weekly, biweekly stays biweekly, monthly stays monthly, one-time never repeats.</small></span></label>{applyRecurrence&&<select value={horizonWeeks} onChange={event=>setHorizonWeeks(Number(event.target.value))}><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option><option value={26}>26 weeks</option><option value={52}>52 weeks</option></select>}</div><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void publishWeek()}>{busy?"Publishing...":"Confirm & publish reviewed week"}</button></section>
    </>}
    {message&&<div className="planner-message">{message}</div>}

    <style jsx global>{`
      .advanced-planner-v3{display:grid;gap:14px;margin-bottom:20px;padding:18px;border:1px solid #d8e6de;border-radius:24px;background:#fff;box-shadow:0 12px 34px rgba(13,73,50,.06)}.planner-hero{display:flex;justify-content:space-between;gap:20px;align-items:end;padding:20px;border-radius:18px;background:linear-gradient(135deg,#0b382a,#0d6a48);color:#fff}.planner-hero span,.planner-preview header span{font-size:10px;font-weight:950;letter-spacing:.13em;color:#9ce3b9}.planner-hero h2{margin:5px 0;font-size:28px}.planner-hero p{margin:0;max-width:820px;color:rgba(255,255,255,.72)}.planner-controls{display:grid;grid-template-columns:1fr 220px 220px;gap:10px}.planner-controls label{display:grid;gap:5px}.planner-controls label>span{font-size:10px;font-weight:900;color:#607168;text-transform:uppercase}.planner-controls input,.planner-controls select,.planner-stop-list select,.planner-recurrence select{min-height:44px;border:1px solid #cbdad2;border-radius:11px;background:#fff;padding:0 11px}.planner-summary{display:grid;align-content:center;padding:8px 14px;border-radius:12px;background:#f2f8f4}.planner-summary b{font-size:22px;color:#0b684c}.planner-summary span{font-size:11px;color:#6d7f75}.planner-customers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;max-height:320px;overflow:auto;padding:10px;border:1px solid #e2ece7;border-radius:16px}.planner-customer-actions{grid-column:1/-1;display:flex;gap:8px}.planner-customer-actions button{border:0;background:transparent;color:#0b7655;font-weight:800;cursor:pointer}.planner-customers>button{display:grid;grid-template-columns:30px 1fr;gap:9px;align-items:center;padding:10px;border:1px solid #e3ece8;border-radius:12px;background:#fff;text-align:left}.planner-customers>button.active{border-color:#0b7655;background:#edf8f2}.planner-customers b{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#eaf2ee;color:#0b684c}.planner-customers strong,.planner-customers small{display:block}.planner-customers small{margin-top:3px;color:#6d7f75}.planner-capacities{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.planner-capacities label{display:grid;gap:5px;padding:11px;border-radius:14px;background:#f4f9f6;text-align:center}.planner-capacities span{font-weight:900;color:#214b3c}.planner-capacities input{width:100%;min-height:42px;border:1px solid #cbdad2;border-radius:10px;text-align:center;font-weight:900}.planner-capacities small{color:#718078}.planner-actions,.planner-publish{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 15px;border-radius:15px;background:#f4f9f6}.planner-actions strong,.planner-actions span{display:block}.planner-actions span{margin-top:3px;color:#718078;font-size:12px}.planner-days{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.planner-days button{display:grid;gap:2px;padding:11px;border:1px solid #dbe7e1;border-radius:13px;background:#fff;color:#173a2c;cursor:pointer}.planner-days button.active{border-color:#0b7655;background:#edf8f2}.planner-days strong{font-size:20px}.planner-days span{font-weight:850}.planner-days small{color:#718078}.planner-preview{display:grid;gap:12px;padding:16px;border:1px solid #dbe7e1;border-radius:18px}.planner-preview>header{display:flex;justify-content:space-between;gap:14px;align-items:end}.planner-preview h3{margin:4px 0;font-size:23px;color:#143c2e}.planner-preview p{margin:0;color:#6b7e74}.planner-stop-list{display:grid;gap:6px}.planner-stop-list article{display:grid;grid-template-columns:32px 1fr 150px;gap:9px;align-items:center;padding:9px;border-radius:11px;background:#f7faf8}.planner-stop-list article>b{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#e7f1eb;color:#0b684c}.planner-stop-list strong,.planner-stop-list small{display:block}.planner-stop-list small{margin-top:2px;color:#6d7f75}.planner-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.planner-metrics div{display:grid;gap:3px;padding:11px;border-radius:12px;background:#f4f9f6}.planner-metrics span{font-size:11px;color:#718078}.planner-metrics strong{font-size:20px;color:#0b684c}.planner-recurrence{display:flex;align-items:center;gap:12px}.planner-recurrence label{display:flex;gap:9px;align-items:flex-start}.planner-recurrence input{margin-top:4px}.planner-recurrence strong,.planner-recurrence small{display:block}.planner-recurrence small{margin-top:3px;color:#718078}.planner-message{padding:12px 14px;border-radius:12px;background:#edf8f2;color:#176344}@media(max-width:1000px){.planner-controls{grid-template-columns:1fr}.planner-capacities,.planner-days{grid-template-columns:repeat(4,1fr)}.planner-hero,.planner-actions,.planner-publish,.planner-preview>header{align-items:stretch;flex-direction:column}.planner-recurrence{align-items:stretch;flex-direction:column}}@media(max-width:650px){.planner-customers{grid-template-columns:1fr}.planner-capacities,.planner-days{grid-template-columns:repeat(2,1fr)}.planner-stop-list article{grid-template-columns:32px 1fr}.planner-stop-list select{grid-column:2}.planner-metrics{grid-template-columns:1fr}}
    `}</style>
  </section>;
}
