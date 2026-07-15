"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DAMASIO_SYNC_EVENT, createCustomerTaskFromService, getLeads, saveFeedback, seedDemoLeads } from "@/lib/storage";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";

type Sentiment = "like" | "dislike" | null;

export default function MobileCustomerApp(){
  const [refreshKey,setRefreshKey]=useState(0);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [sentiment,setSentiment]=useState<Sentiment>(null);
  const [comment,setComment]=useState("");
  const [createTask,setCreateTask]=useState(false);
  const [tip,setTip]=useState(0);
  const [customTip,setCustomTip]=useState("");
  const [confirming,setConfirming]=useState(false);
  const [closedVisitId,setClosedVisitId]=useState("");

  const refresh=()=>setRefreshKey(v=>v+1);
  useMobileRealtime(refresh);

  useEffect(()=>{
    try{seedDemoLeads()}catch{setError("Customer data is temporarily unavailable.")}
    const on=()=>refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);
    window.addEventListener("storage",on);
    return()=>{
      window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);
      window.removeEventListener("storage",on);
    };
  },[]);

  const lead=useMemo(()=>{
    refreshKey;
    try{const leads=getLeads();return leads.find(item=>item.status==="completed"&&!item.feedback)||leads[0]||null}catch{return null}
  },[refreshKey]);

  const finalTip=useMemo(()=>{
    if(tip>0)return tip;
    const parsed=Number(customTip);
    return Number.isFinite(parsed)&&parsed>0?Math.round(parsed*100)/100:0;
  },[tip,customTip]);

  const feedbackClosed=Boolean(lead&&(lead.feedback||closedVisitId===lead.id));

  function resetForm(){
    setSentiment(null);
    setComment("");
    setCreateTask(false);
    setTip(0);
    setCustomTip("");
    setConfirming(false);
  }

  function prepareSubmit(){
    setError("");
    if(!lead||busy)return;
    if(!sentiment){setError("Choose Like or Dislike before sending.");return;}
    if(sentiment==="dislike"&&!comment.trim()){setError("Please tell us what happened.");return;}
    setConfirming(true);
  }

  function submitFeedback(){
    if(!lead||!sentiment||busy)return;
    setBusy(true);
    setError("");
    try{
      saveFeedback(lead.id,{
        rating:sentiment==="like"?5:1,
        comment:comment.trim()||"Service approved by customer.",
        tipAmount:finalTip,
        tipMethod:"card",
        recommend:sentiment==="like"?"yes":"no",
        createdAt:new Date().toISOString()
      });
      if(sentiment==="dislike"&&createTask){
        createCustomerTaskFromService(lead.id,comment.trim());
      }
      setClosedVisitId(lead.id);
      setMessage(createTask?"Feedback sent and Task created for the company Admin.":"Feedback sent. Thank you.");
      resetForm();
      refresh();
    }catch{
      setError("We could not send your feedback. Please try again.");
    }finally{
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell">
    <header className="mobile-topbar"><div className="mobile-brand-mark">D</div><div><strong>Customer Mobile</strong><span>Service status</span></div><div className="mobile-avatar">C</div></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    {!lead?<section className="mobile-empty"><strong>No property found.</strong><p>Customer information will appear here as soon as the account is connected.</p><Link className="mobile-outline" href="/customer">Open Customer Portal</Link></section>:<>
      <section className="mobile-hero-card compact"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>{lead.name}</strong><span>{lead.service}</span></div></div><h1>{lead.status==="completed"?"Service completed":"Service scheduled"}</h1><p>{lead.address}</p></section>
      <section className="mobile-card-list">
        <article className="mobile-issue-card"><strong>Next visit</strong><p>{lead.nextVisitDate||lead.scheduledDate||"To be confirmed"}</p><small>Status: {lead.status}</small></article>

        {!feedbackClosed&&lead.status==="completed"&&<article className="mobile-issue-card mobile-feedback-card">
          <strong>How did we do today?</strong>
          <p>Choose one option. A Dislike can be sent as feedback only or turned into a Task.</p>
          <div className="mobile-sentiment-row">
            <button type="button" className={sentiment==="like"?"like active":"like"} onClick={()=>{setSentiment("like");setCreateTask(false)}} aria-pressed={sentiment==="like"}><span aria-hidden="true">👍</span><b>Like</b></button>
            <button type="button" className={sentiment==="dislike"?"dislike active":"dislike"} onClick={()=>setSentiment("dislike")} aria-pressed={sentiment==="dislike"}><span aria-hidden="true">👎</span><b>Dislike</b></button>
          </div>

          {sentiment&&<>
            <label className="mobile-field-label" htmlFor="feedback-comment">Comment {sentiment==="dislike"?"(required)":"(optional)"}</label>
            <textarea id="feedback-comment" className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder={sentiment==="dislike"?"Tell the company what needs attention.":"Leave a message for the crew."}/>
          </>}

          {sentiment==="dislike"&&<div className="mobile-task-choice">
            <button type="button" className={!createTask?"active":""} onClick={()=>setCreateTask(false)}><span>Feedback only</span><small>Notify Admin without opening a Task.</small></button>
            <button type="button" className={createTask?"task active":"task"} onClick={()=>setCreateTask(true)}><span>Create Task</span><small>Send a red-priority Task directly to Admin.</small></button>
          </div>}

          {sentiment==="like"&&<div className="mobile-tip-box">
            <strong>Tip (optional)</strong>
            <p>Payment by saved card or balance will be enabled with Damasio Pay in the future.</p>
            <div className="mobile-tip-grid">
              {[5,10,20].map(value=><button type="button" key={value} className={tip===value?"active":""} onClick={()=>{setTip(value);setCustomTip("")}}>${value}</button>)}
              <button type="button" className={tip===0&&customTip!==""?"active":""} onClick={()=>setTip(0)}>Custom</button>
            </div>
            {tip===0&&<input className="mobile-tip-input" inputMode="decimal" value={customTip} onChange={e=>setCustomTip(e.target.value.replace(/[^0-9.]/g,""))} placeholder="Custom amount" aria-label="Custom tip amount"/>}
          </div>}

          {sentiment&&<button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={prepareSubmit}>Send feedback</button>}
        </article>}

        <Link className="mobile-admin-action" href="/customer" prefetch={false}><strong>Open Customer Portal</strong><p>Full portal with history and service requests.</p><span>›</span></Link>
      </section>
      {message&&<p className="mobile-message" role="status">{message}</p>}

      {confirming&&<div className="mobile-confirm-backdrop" role="presentation" onClick={()=>!busy&&setConfirming(false)}>
        <section className="mobile-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e=>e.stopPropagation()}>
          <span className={sentiment==="like"?"confirm-icon like":"confirm-icon dislike"}>{sentiment==="like"?"👍":"👎"}</span>
          <h2 id="confirm-title">Confirm feedback</h2>
          <p>{sentiment==="like"?"You are approving today's service.":createTask?"Your feedback will be sent and a Task will be created for Admin.":"Your feedback will be sent to Admin without creating a Task."}</p>
          {finalTip>0&&<div className="mobile-confirm-amount"><span>Tip selected</span><strong>${finalTip.toFixed(2)}</strong><small>No charge is processed until Damasio Pay is activated.</small></div>}
          <div className="mobile-action-grid"><button className="mobile-outline" disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button><button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={submitFeedback}>{busy?"Sending...":"Confirm and send"}</button></div>
        </section>
      </div>}
    </>}
  </main></MobileRoleGuard>
}
