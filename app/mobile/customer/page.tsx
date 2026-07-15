"use client";

import { useMobileRealtime } from "@/lib/mobile/useMobileRealtime";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DAMASIO_SYNC_EVENT, createCustomerTaskFromService, getLeads, saveFeedback, seedDemoLeads } from "@/lib/storage";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {signOutAccount} from "@/lib/auth/signOut";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";

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

  const modules=[
    {href:"/customer/services",icon:"✦",label:"Services"},{href:"/customer/history",icon:"↶",label:"History"},
    {href:"/customer/requests",icon:"＋",label:"Request"},{href:"/customer/estimates",icon:"▤",label:"Estimates"},
    {href:"/customer/invoices",icon:"≡",label:"Invoices"},{href:"/customer/payments",icon:"$",label:"Payments"},
    {href:"/customer/feedback",icon:"★",label:"Feedback"},{href:"/customer/profile",icon:"○",label:"Profile"},
  ];

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell role-customer-mobile">
    <header className="role-mobile-topbar"><MobileBackButton/><div><strong>My home</strong><span>Customer portal</span></div><button type="button" className="role-mobile-avatar" onClick={()=>void signOutAccount("/mobile/login")} aria-label="Sign out">C</button></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    {!lead?<section className="mobile-empty"><strong>No property found.</strong><p>Customer information will appear here as soon as the account is connected.</p><Link className="mobile-outline" href="/customer">Open Customer Portal</Link></section>:<>
      <section className="mobile-hero-card compact role-customer-hero"><span className="role-mobile-eyebrow">YOUR PROPERTY</span><div className="role-customer-status"><i>✓</i><span><strong>{lead.status==="completed"?"Service completed":"Service scheduled"}</strong><small>{lead.service}</small></span></div><p>{lead.address}</p><div className="role-next-visit"><span>Next visit</span><strong>{lead.nextVisitDate||lead.scheduledDate||"To be confirmed"}</strong><small>Status · {lead.status}</small></div></section>
      <section className="role-mobile-section"><div className="role-mobile-section-head"><div><span>MY ACCOUNT</span><h2>What do you need?</h2></div></div><div className="role-customer-modules">{modules.map(module=><Link href={module.href} key={module.href}><i>{module.icon}</i><span>{module.label}</span></Link>)}</div></section>
      <section className="mobile-card-list role-feedback-section">

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
      <nav className="role-mobile-bottom" aria-label="Customer navigation"><Link className="active" href="/mobile/customer"><i>⌂</i><span>Home</span></Link><Link href="/customer/services"><i>✦</i><span>Services</span></Link><Link href="/customer/requests"><i>＋</i><span>Request</span></Link><Link href="/customer/payments"><i>$</i><span>Billing</span></Link><Link href="/customer"><i>•••</i><span>More</span></Link></nav>
    </>}
  </main></MobileRoleGuard>
}
