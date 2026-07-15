"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {signOutAccount} from "@/lib/auth/signOut";
import {readDemoSession} from "@/lib/auth/demoAuth";
import {useMobileRealtime} from "@/lib/mobile/useMobileRealtime";
import type {CustomerPortalBoard} from "@/lib/repositories/customerPortalRepository";
import {addCustomerFeedback,addCustomerServiceRequest,loadCustomerPortal} from "@/lib/services/customerPortalService";
import {DAMASIO_SYNC_EVENT,createCustomerTaskFromService,getLeads,saveFeedback,seedDemoLeads,type Lead} from "@/lib/storage";

type Sentiment="like"|"dislike"|null;
const EMPTY_BOARD:CustomerPortalBoard={property:null,visits:[],tasks:[],requests:[],quotes:[],feedback:[]};

export default function MobileCustomerApp(){
  const[board,setBoard]=useState<CustomerPortalBoard>(EMPTY_BOARD);
  const[demoLead,setDemoLead]=useState<Lead|null>(null);
  const[message,setMessage]=useState("");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  const[sentiment,setSentiment]=useState<Sentiment>(null);const[comment,setComment]=useState("");const[createTask,setCreateTask]=useState(false);
  const[tip,setTip]=useState(0);const[customTip,setCustomTip]=useState("");const[confirming,setConfirming]=useState(false);const[closedVisitId,setClosedVisitId]=useState("");
  const demo=readDemoSession();

  const refresh=useCallback(async()=>{
    if(demo){try{seedDemoLeads();const leads=getLeads();setDemoLead(leads.find(item=>item.status==="completed"&&!item.feedback)||leads[0]||null);setError("")}catch{setError("Customer data is temporarily unavailable.")}return}
    try{setBoard(await loadCustomerPortal({force:true}));setError("")}catch(e){setError(e instanceof Error?e.message:"Customer data is temporarily unavailable.")}
  },[demo?.email]);

  useMobileRealtime(()=>void refresh());
  useEffect(()=>{void refresh();const on=()=>void refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[refresh]);

  const realVisit=useMemo(()=>board.visits.find(visit=>visit.status==="completed"&&!board.feedback.some(feedback=>feedback.visitId===visit.id))||board.visits.filter(visit=>visit.status!=="cancelled").sort((a,b)=>String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0]||null,[board]);
  const lead=demoLead?{id:demoLead.id,name:demoLead.name,service:demoLead.service,status:demoLead.status,address:demoLead.address,nextDate:demoLead.nextVisitDate||demoLead.scheduledDate||null}:realVisit?{id:realVisit.id,name:board.property?.customerName||"Customer",service:realVisit.serviceName,status:realVisit.status,address:realVisit.address||board.property?.address||"Property",nextDate:realVisit.scheduledDate}:null;
  const finalTip=useMemo(()=>{if(tip>0)return tip;const parsed=Number(customTip);return Number.isFinite(parsed)&&parsed>0?Math.round(parsed*100)/100:0},[tip,customTip]);
  const feedbackClosed=Boolean(lead&&(closedVisitId===lead.id||(demoLead?.feedback)||(realVisit&&board.feedback.some(feedback=>feedback.visitId===realVisit.id))));

  function resetForm(){setSentiment(null);setComment("");setCreateTask(false);setTip(0);setCustomTip("");setConfirming(false)}
  function prepareSubmit(){setError("");if(!lead||busy)return;if(!sentiment){setError("Choose Like or Dislike before sending.");return}if(sentiment==="dislike"&&!comment.trim()){setError("Please tell us what happened.");return}setConfirming(true)}
  async function submitFeedback(){
    if(!lead||!sentiment||busy)return;setBusy(true);setError("");
    try{
      if(demoLead){saveFeedback(demoLead.id,{rating:sentiment==="like"?5:1,comment:comment.trim()||"Service approved by customer.",tipAmount:finalTip,tipMethod:"card",recommend:sentiment==="like"?"yes":"no",createdAt:new Date().toISOString()});if(sentiment==="dislike"&&createTask)createCustomerTaskFromService(demoLead.id,comment.trim())}
      else if(realVisit){let updated=await addCustomerFeedback({visitId:realVisit.id,rating:sentiment==="like"?5:1,comment:comment.trim()});if(sentiment==="dislike"&&createTask)updated=await addCustomerServiceRequest({serviceName:"Return Visit",message:comment.trim()||`Return visit requested for ${realVisit.serviceName}.`});setBoard(updated)}
      setClosedVisitId(lead.id);setMessage(createTask?"Feedback sent and a Return Visit was created for Admin.":"Feedback sent. Thank you.");resetForm();await refresh();
    }catch(e){setError(e instanceof Error?e.message:"We could not send your feedback. Please try again.")}finally{setBusy(false)}
  }

  const customerName=board.property?.customerName||demoLead?.name||demo?.name||"Customer";
  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell mobile-customer-shell">
    <header className="mobile-topbar"><div className="mobile-brand-mark">D</div><div><strong>{customerName}</strong><span>Customer Mobile</span></div><button type="button" className="mobile-user-signout" onClick={()=>void signOutAccount("/mobile/login")}><span>{customerName.slice(0,1)}</span><small>Sign out</small></button></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    {!lead?<section className="mobile-empty"><strong>No property found.</strong><p>Your property will appear here as soon as the company connects it to this account.</p><Link className="mobile-outline" href="/customer">Open Customer Portal</Link></section>:<>
      <section className="mobile-hero-card compact"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>{lead.name}</strong><span>{lead.service}</span></div></div><h1>{lead.status==="completed"?"Service completed":"Service scheduled"}</h1><p>{lead.address}</p></section>
      <section className="mobile-card-list"><article className="mobile-issue-card"><strong>{lead.status==="completed"?"Latest visit":"Next visit"}</strong><p>{lead.nextDate||"To be confirmed"}</p><small>Status: {lead.status}</small></article>
        {!feedbackClosed&&lead.status==="completed"&&<article className="mobile-issue-card mobile-feedback-card"><strong>How did we do today?</strong><p>Choose one option. A Dislike can be feedback only or become a Return Visit for Admin.</p>
          <div className="mobile-sentiment-row"><button type="button" className={sentiment==="like"?"like active":"like"} onClick={()=>{setSentiment("like");setCreateTask(false)}}><span aria-hidden="true">👍</span><b>Like</b></button><button type="button" className={sentiment==="dislike"?"dislike active":"dislike"} onClick={()=>setSentiment("dislike")}><span aria-hidden="true">👎</span><b>Dislike</b></button></div>
          {sentiment&&<><label className="mobile-field-label" htmlFor="feedback-comment">Comment {sentiment==="dislike"?"(required)":"(optional)"}</label><textarea id="feedback-comment" className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder={sentiment==="dislike"?"Tell the company what needs attention.":"Leave a message for the crew."}/></>}
          {sentiment==="dislike"&&<div className="mobile-task-choice"><button type="button" className={!createTask?"active":""} onClick={()=>setCreateTask(false)}><span>Feedback only</span><small>Notify Admin without a Return Visit.</small></button><button type="button" className={createTask?"task active":"task"} onClick={()=>setCreateTask(true)}><span>Create Return Visit</span><small>Send it directly to Admin review.</small></button></div>}
          {sentiment==="like"&&<div className="mobile-tip-box"><strong>Tip (optional)</strong><p>No charge is processed until Damasio Pay is activated.</p><div className="mobile-tip-grid">{[5,10,20].map(value=><button type="button" key={value} className={tip===value?"active":""} onClick={()=>{setTip(value);setCustomTip("")}}>${value}</button>)}<button type="button" className={tip===0&&customTip!==""?"active":""} onClick={()=>setTip(0)}>Custom</button></div>{tip===0&&<input className="mobile-tip-input" inputMode="decimal" value={customTip} onChange={e=>setCustomTip(e.target.value.replace(/[^0-9.]/g,""))} placeholder="Custom amount"/>}</div>}
          {sentiment&&<button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={prepareSubmit}>Send feedback</button>}
        </article>}
        <Link className="mobile-admin-action" href="/customer"><strong>Open Customer Portal</strong><p>History, requests, quotes and account details.</p><span>›</span></Link>
      </section>{message&&<p className="mobile-message" role="status">{message}</p>}
      {confirming&&<div className="mobile-confirm-backdrop" role="presentation" onClick={()=>!busy&&setConfirming(false)}><section className="mobile-confirm-dialog" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><span className={sentiment==="like"?"confirm-icon like":"confirm-icon dislike"}>{sentiment==="like"?"👍":"👎"}</span><h2>Confirm feedback</h2><p>{sentiment==="like"?"You are approving this service.":createTask?"Feedback and a Return Visit will be sent to Admin.":"Feedback will be sent without a Return Visit."}</p>{finalTip>0&&<div className="mobile-confirm-amount"><span>Tip selected</span><strong>${finalTip.toFixed(2)}</strong><small>No charge is processed yet.</small></div>}<div className="mobile-action-grid"><button className="mobile-outline" disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button><button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={()=>void submitFeedback()}>{busy?"Sending...":"Confirm and send"}</button></div></section></div>}
    </>}
  </main></MobileRoleGuard>;
}
