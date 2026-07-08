"use client";

import { useState, useEffect } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { confirmDailyChecklist, hasChecklistToday } from "@/lib/storage";

const items=[
  "Oil level checked",
  "Fuel / batteries ready",
  "Trimmer line ready",
  "Mower blade checked",
  "Blower ready",
  "PPE / water loaded",
  "Trailer / truck secured"
];

export default function ChecklistPage(){
  const [checked,setChecked]=useState<string[]>([]);
  const [done,setDone]=useState(false);
  useEffect(()=>setDone(hasChecklistToday("Filipe")),[]);
  function toggle(item:string){setChecked(prev=>prev.includes(item)?prev.filter(x=>x!==item):[...prev,item])}
  function confirm(){confirmDailyChecklist("Filipe","Crew A",checked);setDone(true)}
  return <PortalShell type="Employee" active="Checklist">
    <div className="app-top"><div><span className="eyebrow">Daily Route</span><h1>Daily Checklist</h1><p className="section-intro">Confirm once per day before starting the route.</p></div></div>
    <div className="card checklist-card">
      {done?<div><h2>Checklist confirmed for today</h2><p className="section-intro">You will see this again tomorrow.</p></div>:<><h2>Before leaving, confirm:</h2><div className="checklist-items">{items.map(item=><label className="checklist-item" key={item}><input type="checkbox" checked={checked.includes(item)} onChange={()=>toggle(item)}/>{item}</label>)}</div><button className="btn btn-primary" onClick={confirm} disabled={checked.length<items.length}>Confirm Checklist</button></>}
    </div>
  </PortalShell>
}
