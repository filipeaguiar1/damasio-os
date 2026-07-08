"use client";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getLeads, setLeads, Lead, addNotification, seedDemoLeads } from "@/lib/storage";

function addDays(date:string, days:number){
  const d=date?new Date(date):new Date();
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}

export default function WeatherPage(){
  const [leads,setLocalLeads]=useState<Lead[]>([]);
  const [days,setDays]=useState(1);
  function refresh(){setLocalLeads(getLeads())}
  useEffect(()=>refresh(),[]);
  const scheduled=leads.filter(l=>l.scheduledDate);
  function delayAll(){
    const updated=leads.map(l=>l.scheduledDate?{...l,scheduledDate:addDays(l.scheduledDate,days)}:l);
    setLeads(updated);
    addNotification("weather","Weather delay applied",`${scheduled.length} service(s) moved by ${days} day(s).`);
    refresh();
  }
  return <AdminShell active="Weather Delay">
    <div className="app-top"><div><span className="eyebrow">Operations</span><h1>Weather Delay</h1><p className="section-intro">Move scheduled services forward when rain or weather interrupts the route.</p></div><button className="btn btn-primary" onClick={()=>{seedDemoLeads(true);refresh()}}>Load Demo</button></div>
    <div className="card profile-card"><h2>Delay scheduled jobs</h2><div className="weather-actions"><select className="input" style={{maxWidth:220}} value={days} onChange={e=>setDays(Number(e.target.value))}><option value={1}>Move 1 day</option><option value={2}>Move 2 days</option><option value={3}>Move 3 days</option></select><button className="btn btn-primary" onClick={delayAll}>Apply Weather Delay</button></div><p className="section-intro">{scheduled.length} scheduled service(s) will be affected.</p></div>
  </AdminShell>
}
