"use client";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getExpenses, getLeads, getRecurrences, getEstimates, getEmployeeTasks, Lead, seedDemoExpenses, seedDemoLeads, seedDemoRecurrences, seedDemoEstimates } from "@/lib/storage";
import { generateFollowUpMessage, generateInsights, generateSeasonalCampaign } from "@/lib/aiInsights";

export default function AIPage(){
  const [leads,setLeads]=useState<Lead[]>([]);
  const [message,setMessage]=useState("");
  function refresh(){setLeads(getLeads())}
  useEffect(()=>refresh(),[]);
  const expenses=getExpenses();
  const recurrences=getRecurrences();
  const estimates=getEstimates();
  const tasks=getEmployeeTasks();
  const data=generateInsights(leads,expenses,recurrences);
  const firstLead=leads[0];
  const estimatePipeline=estimates.reduce((s,e)=>s+e.total,0);
  const smart=useMemo(()=>{const overdueTasks=tasks.filter(t=>t.status!=="resolved").length;const pendingPayments=leads.filter(l=>l.paymentStatus==="pending"||l.paymentStatus==="processing").length;const completed=leads.filter(l=>l.status==="completed").length;return [overdueTasks?`Resolve ${overdueTasks} open task(s) before assigning more houses.`:"No open task pressure detected.",pendingPayments?`Follow up with ${pendingPayments} customer(s) with pending/processing payment.`:"Payment queue looks clean.",completed?`${completed} completed job(s) can be used for feedback and review follow-up.`:"Complete jobs first to build feedback history."]},[leads,tasks]);
  function seed(){seedDemoLeads(true);seedDemoExpenses();seedDemoRecurrences();seedDemoEstimates();refresh()}
  return <AdminShell active="AI">
    <div className="app-top"><div><span className="eyebrow">V47 AI Foundation</span><h1>AI Operations Assistant</h1><p className="section-intro">Rule-based AI layer for route risks, payment follow-up, customer health and seasonal campaigns.</p></div><button className="btn btn-primary" onClick={seed}>Load Demo Data</button></div>
    <div className="grid-4" style={{marginBottom:20}}><div className="card dash-card"><div className="mini-label">Revenue</div><div className="mini-value">${data.revenue.toFixed(0)}</div></div><div className="card dash-card"><div className="mini-label">Pipeline</div><div className="mini-value">${estimatePipeline.toFixed(0)}</div></div><div className="card dash-card"><div className="mini-label">Open Quotes</div><div className="mini-value">{data.openQuotes}</div></div><div className="card dash-card"><div className="mini-label">AI Alerts</div><div className="mini-value">{smart.length}</div></div></div>
    <div className="grid-2">
      <div className="ai-card"><h2>Smart Recommendations</h2><div className="insight-list">{smart.map(item=><div className="insight-item" key={item}>{item}</div>)}</div><h2 style={{marginTop:18}}>Business Insights</h2><div className="insight-list">{[...data.insights, estimates.length?`You have ${estimates.length} estimate(s) worth $${estimatePipeline.toFixed(2)} in the sales pipeline.`:"No professional estimates created yet."].map(item=><div className="insight-item" key={item}>{item}</div>)}</div></div>
      <div className="ai-card"><h2>Generate Message</h2><div className="stack"><button className="btn btn-outline" onClick={()=>setMessage(firstLead?generateFollowUpMessage(firstLead.name,firstLead.service):"Load demo data first.")}>Follow-up Message</button><button className="btn btn-outline" onClick={()=>setMessage(generateSeasonalCampaign("spring"))}>Spring Campaign</button><button className="btn btn-outline" onClick={()=>setMessage(generateSeasonalCampaign("fall"))}>Fall Campaign</button><button className="btn btn-outline" onClick={()=>setMessage("Hi, this is Damasio Seasons. Your service was completed today. Please reply if everything looks good or if you need a return visit.")}>Feedback Request</button>{message&&<div className="message-box">{message}</div>}</div></div>
    </div>
  </AdminShell>
}
