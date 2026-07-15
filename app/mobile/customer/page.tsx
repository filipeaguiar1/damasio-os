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
type CustomerTab="home"|"feedback"|"services"|"account";
const EMPTY_BOARD:CustomerPortalBoard={property:null,visits:[],tasks:[],requests:[],quotes:[],feedback:[]};

export default function MobileCustomerApp(){
  const[board,setBoard]=useState<CustomerPortalBoard>(EMPTY_BOARD);
  const[demoLead,setDemoLead]=useState<Lead|null>(null);
  const[message,setMessage]=useState("");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  const[sentiment,setSentiment]=useState<Sentiment>(null);const[comment,setComment]=useState("");const[createTask,setCreateTask]=useState(false);
  const[tip,setTip]=useState(0);const[customTip,setCustomTip]=useState("");const[confirming,setConfirming]=useState(false);const[closedVisitId,setClosedVisitId]=useState("");
  const[tab,setTab]=useState<CustomerTab>("home");
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
  const canReview=Boolean(lead&&!feedbackClosed&&lead.status==="completed");
  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell mobile-customer-shell">
    <header className="mobile-topbar mobile-compact-topbar"><div className="mobile-brand-mark">D</div><div><strong>{customerName}</strong><span>Customer Portal</span></div><button type="button" className="mobile-profile-button" onClick={()=>setTab("account")} aria-label="Open account">{customerName.slice(0,1)}</button></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    {!lead?<section className="mobile-tab-panel mobile-empty"><strong>No property found.</strong><p>Your property will appear here as soon as the company connects it to this account.</p><Link className="mobile-outline" href="/customer">Open Customer Portal</Link></section>:<>
      {tab==="home"&&<div className="mobile-tab-panel"><section className="mobile-compact-summary customer"><div><span>{lead.status==="completed"?"Latest service":"Next service"}</span><strong>{lead.service}</strong><small>{lead.address}</small></div><b className={lead.status==="completed"?"mobile-status done":"mobile-status"}>{lead.status}</b></section><article className="mobile-visit-card"><div><span>{lead.status==="completed"?"Completed":"Scheduled"}</span><strong>{lead.nextDate||"To be confirmed"}</strong></div>{canReview?<button onClick={()=>setTab("feedback")}>Leave feedback</button>:<Link href="/customer/history">View history</Link>}</article><section className="mobile-quick-grid customer"><button onClick={()=>setTab("services")}><span>＋</span><strong>Services</strong><small>Request help</small></button><button onClick={()=>setTab("feedback")}><span>★</span><strong>Feedback</strong><small>{canReview?"Waiting":"Up to date"}</small></button><Link href="/customer/history"><span>↻</span><strong>History</strong><small>Past visits</small></Link><Link href="/customer/tasks"><span>!</span><strong>Issues</strong><small>Return visits</small></Link></section></div>}
      {tab==="feedback"&&<section className="mobile-tab-panel mobile-card-list"><div className="mobile-panel-heading"><div><span>Latest visit</span><h1>Feedback</h1></div><small>{lead.service}</small></div>{canReview?<article className="mobile-issue-card mobile-feedback-card"><strong>How did we do?</strong><p>Choose one option. A Dislike can be feedback only or become a Return Visit for Admin.</p>
          <div className="mobile-sentiment-row"><button type="button" className={sentiment==="like"?"like active":"like"} onClick={()=>{setSentiment("like");setCreateTask(false)}}><span aria-hidden="true">👍</span><b>Like</b></button><button type="button" className={sentiment==="dislike"?"dislike active":"dislike"} onClick={()=>setSentiment("dislike")}><span aria-hidden="true">👎</span><b>Dislike</b></button></div>
          {sentiment&&<><label className="mobile-field-label" htmlFor="feedback-comment">Comment {sentiment==="dislike"?"(required)":"(optional)"}</label><textarea id="feedback-comment" className="mobile-textarea" value={comment} onChange={e=>setComment(e.target.value)} placeholder={sentiment==="dislike"?"Tell the company what needs attention.":"Leave a message for the crew."}/></>}
          {sentiment==="dislike"&&<div className="mobile-task-choice"><button type="button" className={!createTask?"active":""} onClick={()=>setCreateTask(false)}><span>Feedback only</span><small>Notify Admin without a Return Visit.</small></button><button type="button" className={createTask?"task active":"task"} onClick={()=>setCreateTask(true)}><span>Create Return Visit</span><small>Send it directly to Admin review.</small></button></div>}
          {sentiment==="like"&&<div className="mobile-tip-box"><strong>Tip (optional)</strong><p>No charge is processed until Damasio Pay is activated.</p><div className="mobile-tip-grid">{[5,10,20].map(value=><button type="button" key={value} className={tip===value?"active":""} onClick={()=>{setTip(value);setCustomTip("")}}>${value}</button>)}<button type="button" className={tip===0&&customTip!==""?"active":""} onClick={()=>setTip(0)}>Custom</button></div>{tip===0&&<input className="mobile-tip-input" inputMode="decimal" value={customTip} onChange={e=>setCustomTip(e.target.value.replace(/[^0-9.]/g,""))} placeholder="Custom amount"/>}</div>}
          {sentiment&&<button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={prepareSubmit}>Send feedback</button>}
        </article>:<div className="mobile-empty"><strong>Feedback is up to date.</strong><p>Completed services waiting for review will appear here.</p><Link className="mobile-outline" href="/customer/feedback">View feedback history</Link></div>}</section>}
      {tab==="services"&&<section className="mobile-tab-panel mobile-card-list"><div className="mobile-panel-heading"><div><span>Your property</span><h1>Services</h1></div><small>Quick access</small></div><Link className="mobile-admin-action" href="/customer/next-visit"><strong>Next Visit</strong><p>Date, service and crew details.</p><span>›</span></Link><Link className="mobile-admin-action" href="/customer/requests"><strong>Request Service</strong><p>Ask the company for additional work.</p><span>›</span></Link><Link className="mobile-admin-action" href="/customer/history"><strong>Service History</strong><p>Review completed visits.</p><span>›</span></Link><Link className="mobile-admin-action" href="/customer/tasks"><strong>Service Issues</strong><p>Follow return visits and resolutions.</p><span>›</span></Link></section>}
      {tab==="account"&&<section className="mobile-tab-panel"><div className="mobile-account-card"><span>{customerName.slice(0,1)}</span><h1>{customerName}</h1><p>{board.property?.address||lead.address}</p><small>Customer account</small><Link href="/customer/profile">Open profile</Link><button type="button" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button></div></section>}
      {message&&<p className="mobile-message" role="status">{message}</p>}
      {confirming&&<div className="mobile-confirm-backdrop" role="presentation" onClick={()=>!busy&&setConfirming(false)}><section className="mobile-confirm-dialog" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><span className={sentiment==="like"?"confirm-icon like":"confirm-icon dislike"}>{sentiment==="like"?"👍":"👎"}</span><h2>Confirm feedback</h2><p>{sentiment==="like"?"You are approving this service.":createTask?"Feedback and a Return Visit will be sent to Admin.":"Feedback will be sent without a Return Visit."}</p>{finalTip>0&&<div className="mobile-confirm-amount"><span>Tip selected</span><strong>${finalTip.toFixed(2)}</strong><small>No charge is processed yet.</small></div>}<div className="mobile-action-grid"><button className="mobile-outline" disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button><button className={createTask?"mobile-task-submit":"mobile-primary"} disabled={busy} onClick={()=>void submitFeedback()}>{busy?"Sending...":"Confirm and send"}</button></div></section></div>}
    </>}
    <nav className="mobile-bottom-nav" aria-label="Customer mobile navigation"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><span>⌂</span><small>Home</small></button><button className={tab==="services"?"active":""} onClick={()=>setTab("services")}><span>＋</span><small>Services</small></button><button className={tab==="feedback"?"active":""} onClick={()=>setTab("feedback")}><span>★</span><small>Feedback</small>{canReview&&<b>1</b>}</button><button className={tab==="account"?"active":""} onClick={()=>setTab("account")}><span>○</span><small>Account</small></button></nav>
  </main></MobileRoleGuard>;
}
