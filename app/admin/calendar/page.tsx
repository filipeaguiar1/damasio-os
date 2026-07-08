"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {calculateVisitStatus,DAMASIO_CREWS,DAMASIO_SYNC_EVENT,DAMASIO_WEEK_DAYS,getLeads,getRegionFromAddress,Lead,seedDemoLeads} from "@/lib/storage";

function label(s:ReturnType<typeof calculateVisitStatus>){return s==="upcoming"?"Needs booking":s[0].toUpperCase()+s.slice(1)}
function iso(d:Date){return d.toISOString().slice(0,10)}
function startOfWeek(base:Date){const d=new Date(base);const day=d.getDay();const diff=(day===0?-6:1-day);d.setDate(d.getDate()+diff);d.setHours(12,0,0,0);return d}
function addDays(base:Date,n:number){const d=new Date(base);d.setDate(d.getDate()+n);d.setHours(12,0,0,0);return d}
function fmtDay(d:Date){return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}
function fmtLong(d:Date){return d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
function startOfMonth(base:Date){const d=new Date(base);d.setDate(1);d.setHours(12,0,0,0);return d}
function addMonths(base:Date,n:number){const d=new Date(base);d.setMonth(d.getMonth()+n);d.setHours(12,0,0,0);return d}
function monthTitle(d:Date){return d.toLocaleDateString(undefined,{month:"long",year:"numeric"})}
function monthGrid(base:Date){const first=startOfMonth(base);const start=startOfWeek(first);return Array.from({length:42},(_,i)=>addDays(start,i))}
function weekRange(start:Date){const end=addDays(start,6);return `${start.toLocaleDateString(undefined,{month:"long",day:"numeric"})} – ${end.toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"})}`}
function niceDate(v?:string){return v?new Date(v+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}):"Not set"}
function occursOnDate(lead:Lead,date:Date){
  const dateKey=iso(date);
  const dayName=DAMASIO_WEEK_DAYS[(date.getDay()+6)%7];
  if(lead.nextVisitDate){
    const next=new Date(lead.nextVisitDate+"T12:00:00");
    const diffDays=Math.round((date.getTime()-next.getTime())/86400000);
    if(diffDays<0)return false;
    if(lead.serviceFrequency==="biweekly")return diffDays%14===0;
    if(lead.serviceFrequency==="monthly")return date.getDate()===next.getDate();
    return lead.serviceDay?lead.serviceDay===dayName:dateKey===lead.nextVisitDate;
  }
  return lead.serviceDay===dayName;
}

export default function Calendar(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[weekStart,setWeekStart]=useState<Date>(()=>startOfWeek(new Date()));
  const[day,setDay]=useState("Monday");
  const[crew,setCrew]=useState("All Crews");
  const[view,setView]=useState<"week"|"month">("week");
  function refresh(){setLeads(getLeads())}
  useEffect(()=>{seedDemoLeads();refresh();const on=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const q=params.get("day");if(q&&DAMASIO_WEEK_DAYS.includes(q))setDay(q)},[]);

  const weekDays=useMemo(()=>DAMASIO_WEEK_DAYS.map((name,i)=>({name,date:addDays(weekStart,i),key:iso(addDays(weekStart,i))})),[weekStart]);
  const selectedDayDate=weekDays.find(d=>d.name===day)?.date||weekStart;
  const dayHomes=useMemo(()=>leads.filter(l=>l.serviceDay===day).filter(l=>crew==="All Crews"?true:l.assignedCrew===crew).sort((a,b)=>(a.assignedCrew||"").localeCompare(b.assignedCrew||"")||getRegionFromAddress(a.address).localeCompare(getRegionFromAddress(b.address))||a.address.localeCompare(b.address)),[leads,day,crew]);
  const statusCounts=useMemo(()=>({
    completed:leads.filter(l=>calculateVisitStatus(l)==="completed").length,
    booked:leads.filter(l=>calculateVisitStatus(l)==="booked").length,
    upcoming:leads.filter(l=>calculateVisitStatus(l)==="upcoming").length,
    overdue:leads.filter(l=>calculateVisitStatus(l)==="overdue").length,
  }),[leads]);

  return <AdminShell active="Calendar">
    <div className="calendar-heading">
      <div>
        <h1>Weekly Calendar <span>▣</span></h1>
        <p>No fixed visit hours. Manage days, route order and booking status.</p>
      </div>
      <button className="btn btn-primary" onClick={()=>{seedDemoLeads(true);refresh()}}>+ Load Demo</button>
    </div>

    <div className="week-toolbar">
      <button className="week-btn" onClick={()=>view==="week"?setWeekStart(addDays(weekStart,-7)):setWeekStart(startOfMonth(addMonths(weekStart,-1)))}>‹ {view==="week"?"Previous Week":"Previous Month"}</button>
      <div className="week-range">▣ {view==="week"?weekRange(weekStart):monthTitle(weekStart)} <span>⌄</span></div>
      <button className="week-btn" onClick={()=>view==="week"?setWeekStart(addDays(weekStart,7)):setWeekStart(startOfMonth(addMonths(weekStart,1)))}>{view==="week"?"Next Week":"Next Month"} ›</button>
      <div className="view-toggle"><button className={view==="week"?"active":""} onClick={()=>setView("week")}>Week View</button><button className={view==="month"?"active":""} onClick={()=>setView("month")}>Month View</button></div>
      <Link className="btn btn-primary" href="/admin/routes">+ Create Route</Link>
    </div>

    {view==="week"&&<div className="pro-day-grid">{weekDays.map(({name,date})=>{const count=leads.filter(l=>l.serviceDay===name).length;const overdue=leads.filter(l=>l.serviceDay===name&&calculateVisitStatus(l)==="overdue").length;return <button className={day===name?"pro-day-card active":"pro-day-card"} key={name} onClick={()=>setDay(name)}><strong>{name}</strong><span>{fmtDay(date)}</span><b>{count}</b><small>{count===1?"Home":"Homes"}</small><em className={overdue?"warn":""}>{overdue?`${overdue} overdue`:count?`${count} to manage`:"No homes"}</em></button>})}</div>}

    {view==="month"&&<section className="month-board"><div className="month-week-head">{DAMASIO_WEEK_DAYS.map(d=><strong key={d}>{d.slice(0,3)}</strong>)}</div><div className="month-grid">{monthGrid(weekStart).map((date)=>{const dateKey=iso(date);const dateDay=DAMASIO_WEEK_DAYS[(date.getDay()+6)%7];const inMonth=date.getMonth()===weekStart.getMonth();const homes=leads.filter(l=>occursOnDate(l,date));const overdue=homes.filter(h=>calculateVisitStatus(h)==="overdue").length;return <button key={dateKey} className={inMonth?"month-cell":"month-cell muted"} onClick={()=>{setDay(dateDay);setWeekStart(startOfWeek(date));setView("week")}}><span>{date.getDate()}</span><b>{homes.length?`${homes.length} homes`:""}</b>{overdue>0&&<em>{overdue} overdue</em>}</button>})}</div></section>}

    <div className="status-action-grid">
      <Link href="/admin/alerts?status=completed" className="status-action green"><i>✓</i><b>{statusCounts.completed}</b><div><strong>Completed</strong><span>Great job!</span></div><em>›</em></Link>
      <Link href="/admin/alerts?status=booked" className="status-action blue"><i>▣</i><b>{statusCounts.booked}</b><div><strong>Booked</strong><span>All set</span></div><em>›</em></Link>
      <Link href="/admin/alerts?status=upcoming" className="status-action yellow"><i>◷</i><b>{statusCounts.upcoming}</b><div><strong>Needs booking soon</strong><span>Next 3 days</span></div><em>›</em></Link>
      <Link href="/admin/alerts?status=overdue" className="status-action red"><i>!</i><b>{statusCounts.overdue}</b><div><strong>Overdue</strong><span>{statusCounts.overdue?"Needs action":"You're all caught up!"}</span></div><em>›</em></Link>
    </div>

    <section className="calendar-work-card">
      <div className="calendar-work-head"><div><h2>{fmtLong(selectedDayDate)}</h2><span>{dayHomes.length} {dayHomes.length===1?"Home":"Homes"}</span></div><div className="inline-actions"><select className="input" value={crew} onChange={e=>setCrew(e.target.value)}><option>All Crews</option>{DAMASIO_CREWS.map(c=><option key={c}>{c}</option>)}</select><Link className="btn btn-outline" href={`/admin/routes?day=${encodeURIComponent(day)}`}>▰ Open Routes</Link><Link className="btn btn-primary" href="/admin/customers">♙ Assign Homes</Link></div></div>
      <div className="pro-route-list">{dayHomes.map((l,i)=>{const st=calculateVisitStatus(l);return <div className="pro-route-row" key={l.id}><span className="route-number">{i+1}</span><div className="home-thumb"><div></div></div><div className="home-info"><strong>{l.name}</strong><p>{l.address}</p><small className={l.serviceFrequency==="biweekly"?"freq bi":"freq"}>{l.serviceFrequency||"weekly"}</small></div><div className="crew-cell"><span className="crew-faces"><i></i><i></i></span><strong>{l.assignedCrew||"Unassigned"}</strong><p>{l.assignedCrew?"Route assigned":"Needs assignment"}</p></div><div className="booking-cell"><span className={`dot ${st}`}></span><strong>{label(st)}</strong><p>Next: {niceDate(l.nextVisitDate)}</p></div><Link className="open-btn" href={`/admin/customers/${l.id}`}>↗ Open</Link><button className="dots">•••</button></div>})}{!dayHomes.length&&<p className="section-intro empty-state">No homes scheduled for {day}. Use Assign Homes to add customers to this day.</p>}</div>
    </section>
  </AdminShell>
}
