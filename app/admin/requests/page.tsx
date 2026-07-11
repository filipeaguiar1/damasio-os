"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {DAMASIO_CREWS,DAMASIO_WEEK_DAYS,ServiceRequest,assignRequestToCrew,createEstimateFromRequest,formatLongDate,getServiceRequests,nextVisitFor,seedDemoRequests,updateServiceRequest,getInvoiceForRequest,isEstimatePaid} from "@/lib/storage";

const statuses:[ServiceRequest["status"],string][]= [["pending","Pending"],["quoted","Quoted"],["accepted","Accepted"],["scheduled","Scheduled"],["rejected","Rejected"],["completed","Completed"]];

export default function AdminRequests(){
  const[requests,setRequests]=useState<ServiceRequest[]>([]);
  const[filter,setFilter]=useState<ServiceRequest["status"]|"all">("pending");
  const[amounts,setAmounts]=useState<Record<string,string>>({});
  const[crew,setCrew]=useState<Record<string,string>>({});
  const[date,setDate]=useState<Record<string,string>>({});
  const[msg,setMsg]=useState("");
  function refresh(){setRequests(getServiceRequests())}
  useEffect(()=>{seedDemoRequests();refresh()},[]);
  const counts=useMemo(()=>Object.fromEntries(statuses.map(([s])=>[s,requests.filter(r=>r.status===s).length])),[requests]) as Record<ServiceRequest["status"],number>;
  const visible=filter==="all"?requests:requests.filter(r=>r.status===filter);
  function updateFinalStatus(r:ServiceRequest,status:ServiceRequest["status"]){
    if((r.status==="accepted"||r.status==="rejected")&&(status==="accepted"||status==="rejected")){setMsg("Accepted/rejected requests are locked. Final customer decisions cannot be reversed.");return;}
    if((status==="accepted"||status==="rejected")&&!window.confirm(`Are you sure you want to ${status==="accepted"?"approve":"reject"} this quote? This decision is final.`)) return;
    updateServiceRequest(r.id,{status});refresh();
  }
  function assign(r:ServiceRequest){
    const c=crew[r.id]||r.assignedCrew||DAMASIO_CREWS[0];
    const dt=date[r.id]||r.scheduledDate||nextVisitFor("Monday","seasonal");
    const d=new Date(dt+"T12:00:00").toLocaleDateString([], {weekday:"long"});
    assignRequestToCrew(r.id,c,d,dt);
    setMsg(`${r.service} assigned to ${c} for ${formatLongDate(dt)}.`);
    refresh();
  }
  return <AdminShell active="Requests">
    <div className="app-top"><div><span className="eyebrow">Smart Workflow</span><h1>Requests <em className="notification-count">{counts.pending}</em></h1><p className="section-intro">Request → Quote → Customer decision → Payment → Create Job → Route → Employee → Completed → Feedback → History.</p></div><button className="btn btn-outline" onClick={()=>{seedDemoRequests();refresh()}}>Load Demo</button></div>
    {msg&&<div className="notice" style={{marginBottom:18}}>{msg}</div>}
    <section className="business-metrics request-metrics"><button className={filter==="all"?"business-metric active":"business-metric"} onClick={()=>setFilter("all")}><span>All</span><strong>{requests.length}</strong><small>all requests</small></button>{statuses.map(([s,label])=><button key={s} className={filter===s?"business-metric active":"business-metric"} onClick={()=>setFilter(s)}><span>{label}</span><strong>{counts[s]}</strong><small>{s==="pending"?"needs quote":s}</small></button>)}</section>
    <section className="card table-card"><div className="table-head"><div><h2>Workflow Queue</h2><p className="section-intro">After approval, assign the job with one combined calendar date. Example: Wednesday, July 8, 2026.</p></div></div><div className="table-wrap workflow-desktop-table"><table><thead><tr><th>Request</th><th>Customer / House</th><th>Status</th><th>Quote</th><th>Create Job</th><th>Actions</th></tr></thead><tbody>{visible.length===0?<tr><td colSpan={6}>No requests in this status.</td></tr>:visible.map(r=>{
      const finalLocked=r.status==="accepted"||r.status==="rejected"||r.status==="scheduled"||r.status==="completed";
      const selectedDate=date[r.id]||r.scheduledDate||nextVisitFor("Monday","seasonal");
      const invoice = getInvoiceForRequest(r.id);
      const paid = r.estimateId ? isEstimatePaid(r.estimateId) : false;
      return <tr key={r.id}><td><strong>{r.service}</strong><br/><small>{new Date(r.createdAt).toLocaleString()}</small><p>{r.message||"No notes"}</p></td><td>{r.customerName}<br/><small>{r.phone} · {r.email}</small><br/><Link className="open-inline" href={`/admin/customers?search=${encodeURIComponent(r.address)}`}>Check house: {r.address}</Link></td><td><span className={`request-status ${r.status}`}>{r.status}</span>{invoice&&<p><small>Invoice: {invoice.status.replace("_"," ")}</small></p>}{r.scheduledDate&&<p><small>{formatLongDate(r.scheduledDate)}</small></p>}</td><td>{r.estimateId?<Link className="btn btn-outline" href="/admin/estimates">Open Estimate</Link>:<div className="row"><input className="input compact-input" value={amounts[r.id]||"299"} onChange={e=>setAmounts({...amounts,[r.id]:e.target.value})}/><button className="btn btn-primary" onClick={()=>{createEstimateFromRequest(r.id,Number(amounts[r.id]||299));refresh()}}>Send Quote</button></div>}</td><td><div className="request-assign-box"><select className="input" value={crew[r.id]||r.assignedCrew||DAMASIO_CREWS[0]} onChange={e=>setCrew({...crew,[r.id]:e.target.value})}>{DAMASIO_CREWS.map(c=><option key={c}>{c}</option>)}</select><input className="input" type="date" value={selectedDate} onChange={e=>setDate({...date,[r.id]:e.target.value})}/><strong className="date-preview">{formatLongDate(selectedDate)}</strong><button className="btn btn-primary" disabled={!paid&&r.status!=="scheduled"&&r.status!=="completed"} onClick={()=>assign(r)}>{r.jobId?"Update Job":"Create Job"}</button>{!paid&&r.status!=="scheduled"&&r.status!=="completed"&&<small>Available after invoice is paid.</small>}</div></td><td><div className="row"><select className="input" value={r.status} disabled={finalLocked} onChange={e=>updateFinalStatus(r,e.target.value as ServiceRequest["status"])}>{statuses.filter(([s])=>s!=="scheduled"&&s!=="completed").map(([s,label])=><option key={s} value={s}>{label}</option>)}</select>{r.status!=="completed"&&r.status!=="rejected"&&<button className="btn btn-outline" onClick={()=>{updateServiceRequest(r.id,{status:"completed"});refresh()}}>Mark Completed</button>}</div></td></tr>
    })}</tbody></table></div>
      <div className="workflow-mobile-list">
        {visible.length===0?<div className="mobile-empty">No requests in this status.</div>:visible.map(r=>{
          const finalLocked=r.status==="accepted"||r.status==="rejected"||r.status==="scheduled"||r.status==="completed";
          const selectedDate=date[r.id]||r.scheduledDate||nextVisitFor("Monday","seasonal");
          const invoice=getInvoiceForRequest(r.id);
          const paid=r.estimateId?isEstimatePaid(r.estimateId):false;
          return <article className="workflow-mobile-card" key={`mobile-${r.id}`}>
            <h3>{r.service}</h3>
            <p><strong>{r.customerName}</strong></p>
            <p>{r.address}</p>
            <div className="workflow-mobile-meta">
              <div><span>Status</span><strong>{r.status}</strong></div>
              <div><span>Created</span><strong>{new Date(r.createdAt).toLocaleDateString()}</strong></div>
              <div><span>Phone</span><strong>{r.phone||"-"}</strong></div>
              <div><span>Invoice</span><strong>{invoice?.status.replace("_"," ")||"Not created"}</strong></div>
            </div>
            {r.message&&<p>{r.message}</p>}
            <div className="workflow-mobile-actions">
              {r.estimateId?<Link className="btn btn-outline" href="/admin/estimates">Open Estimate</Link>:<div className="row"><input aria-label="Quote amount" className="input" value={amounts[r.id]||"299"} onChange={e=>setAmounts({...amounts,[r.id]:e.target.value})}/><button className="btn btn-primary" onClick={()=>{createEstimateFromRequest(r.id,Number(amounts[r.id]||299));refresh()}}>Send Quote</button></div>}
              <select aria-label="Crew" className="input" value={crew[r.id]||r.assignedCrew||DAMASIO_CREWS[0]} onChange={e=>setCrew({...crew,[r.id]:e.target.value})}>{DAMASIO_CREWS.map(c=><option key={c}>{c}</option>)}</select>
              <input aria-label="Service date" className="input" type="date" value={selectedDate} onChange={e=>setDate({...date,[r.id]:e.target.value})}/>
              <button className="btn btn-primary" disabled={!paid&&r.status!=="scheduled"&&r.status!=="completed"} onClick={()=>assign(r)}>{r.jobId?"Update Job":"Create Job"}</button>
              {!paid&&r.status!=="scheduled"&&r.status!=="completed"&&<small>Available after invoice is paid.</small>}
              <select aria-label="Request status" className="input" value={r.status} disabled={finalLocked} onChange={e=>updateFinalStatus(r,e.target.value as ServiceRequest["status"])}>{statuses.filter(([s])=>s!=="scheduled"&&s!=="completed").map(([s,label])=><option key={s} value={s}>{label}</option>)}</select>
              {r.status!=="completed"&&r.status!=="rejected"&&<button className="btn btn-outline" onClick={()=>{updateServiceRequest(r.id,{status:"completed"});refresh()}}>Mark Completed</button>}
            </div>
          </article>
        })}
      </div>
    </section>
  </AdminShell>
}
