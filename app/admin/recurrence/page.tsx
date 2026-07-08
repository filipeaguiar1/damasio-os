"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getRecurrences, saveRecurrence, seedDemoRecurrences, toggleRecurrence, Recurrence } from "@/lib/storage";

export default function RecurrencePage(){
  const [rows,setRows]=useState<Recurrence[]>([]);
  const [form,setForm]=useState({customer:"",service:"Weekly Lawn Care",address:"",frequency:"weekly" as Recurrence["frequency"],nextDate:""});
  function refresh(){setRows(getRecurrences())}
  useEffect(()=>refresh(),[]);
  function add(){saveRecurrence({...form,active:true});setForm({customer:"",service:"Weekly Lawn Care",address:"",frequency:"weekly",nextDate:""});refresh()}
  return <AdminShell active="Recurrence">
    <div className="app-top"><div><span className="eyebrow">Automation</span><h1>Recurring Services</h1><p className="section-intro">Weekly, biweekly, monthly and seasonal recurring work.</p></div><button className="btn btn-primary" onClick={()=>{seedDemoRecurrences();refresh()}}>Load Demo</button></div>
    <div className="card profile-card" style={{marginBottom:20}}><h2>Add Recurrence</h2><div className="form-grid"><input className="input" placeholder="Customer" value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/><input className="input" placeholder="Address" value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/><select className="input" value={form.service} onChange={e=>setForm({...form,service:e.target.value})}><option>Weekly Lawn Care</option><option>Biweekly Lawn Care</option><option>Spring Cleanup</option><option>Fall Cleanup</option></select><select className="input" value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value as any})}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="seasonal">Seasonal</option></select><input className="input" type="date" value={form.nextDate} onChange={e=>setForm({...form,nextDate:e.target.value})}/></div><button className="btn btn-primary" style={{marginTop:14}} onClick={add}>Add Recurrence</button></div>
    <section className="card table-card"><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Frequency</th><th>Next Date</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.length===0?<tr><td colSpan={6}>No recurring services yet.</td></tr>:rows.map(r=><tr key={r.id}><td>{r.customer}<br/>{r.address}</td><td>{r.service}</td><td><span className="recurrence-pill">{r.frequency}</span></td><td>{r.nextDate}</td><td>{r.active?"Active":"Paused"}</td><td><button className="btn btn-outline" onClick={()=>{toggleRecurrence(r.id);refresh()}}>{r.active?"Pause":"Activate"}</button></td></tr>)}</tbody></table></div></section>
  </AdminShell>
}
