"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { emptyAdminAlertCenter, getAdminAlertCenter, type AdminAlertCenter } from "@/lib/repositories/adminAlertsRepository";
import styles from "./alerts.module.css";

type Tab = "all" | "return-visits" | "pending-payments" | "low-reviews" | "completed" | "booked" | "upcoming" | "overdue";
type QueueItem = { id:string; kind:"task"|"payment"|"feedback"|"visit"; customerId:string; title:string; address:string; detail:string; status:string; date:string; href:string; icon:string };
const pageSize=25;

function dateLabel(value?:string|null){
  if(!value)return "No date";
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T12:00:00`):new Date(value);
  return parsed.toLocaleDateString("en-CA",{month:"short",day:"numeric",year:"numeric"});
}

export default function AlertsPage(){
  const[data,setData]=useState<AdminAlertCenter>(emptyAdminAlertCenter);
  const[tab,setTab]=useState<Tab>("all");
  const[query,setQuery]=useState("");
  const[page,setPage]=useState(1);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("");

  async function load(){
    setLoading(true);
    try{setData(await getAdminAlertCenter());setMessage("");}
    catch(error){setMessage(error instanceof Error?error.message:"Alert Center could not be loaded.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();const params=new URLSearchParams(window.location.search);const requested=(params.get("tab")||params.get("status")||"all") as Tab;if(["all","return-visits","pending-payments","low-reviews","completed","booked","upcoming","overdue"].includes(requested))setTab(requested);const timer=window.setInterval(()=>void getAdminAlertCenter().then(setData).catch(()=>undefined),30000);return()=>window.clearInterval(timer)},[]);
  useEffect(()=>setPage(1),[tab,query]);

  const buckets=useMemo(()=>({
    returnVisits:data.tasks.length,
    payments:data.payments.length,
    reviews:data.feedback.length,
    completed:data.visits.filter(item=>item.category==="completed").length,
    booked:data.visits.filter(item=>item.category==="booked").length,
    upcoming:data.visits.filter(item=>item.category==="upcoming").length,
    overdue:data.visits.filter(item=>item.category==="overdue").length,
  }),[data]);

  const items=useMemo(()=>{
    const tasks:QueueItem[]=data.tasks.map(item=>({id:item.id,kind:"task",customerId:item.customerId,title:item.customerName,address:item.address,detail:`${item.title} · ${item.detail||"Return visit"}`,status:`${item.priority} · ${item.status.replaceAll("_"," ")}`,date:item.scheduledDate||item.createdAt,href:`/admin/tasks/${item.id}`,icon:"↺"}));
    const payments:QueueItem[]=data.payments.map(item=>({id:item.id,kind:"payment",customerId:item.customerId,title:item.customerName,address:item.address||"Customer account",detail:`${item.number} · ${new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(item.total||0))}`,status:item.status.replaceAll("_"," "),date:item.createdAt,href:`/admin/finance/actions?customer=${encodeURIComponent(item.customerId)}`,icon:"$"}));
    const reviews:QueueItem[]=data.feedback.map(item=>({id:item.id,kind:"feedback",customerId:item.customerId,title:item.customerName,address:item.address||"Property",detail:item.comment||"Low rating needs review",status:`${item.rating}/5 review`,date:item.createdAt,href:`/admin/customers/${item.customerId}`,icon:"★"}));
    const visits:QueueItem[]=data.visits.map(item=>({id:item.id,kind:"visit",customerId:item.customerId,title:item.customerName,address:item.address||"Property",detail:`Service visit · ${dateLabel(item.scheduledDate)}`,status:item.category.replaceAll("_"," "),date:item.scheduledDate,href:`/admin/customers/${item.customerId}?tab=service-screen`,icon:item.category==="overdue"?"!":item.category==="completed"?"✓":"⌂"}));
    const selected=tab==="return-visits"?tasks:tab==="pending-payments"?payments:tab==="low-reviews"?reviews:tab==="completed"?visits.filter(item=>item.status==="completed"):tab==="booked"?visits.filter(item=>item.status==="booked"):tab==="upcoming"?visits.filter(item=>item.status==="upcoming"):tab==="overdue"?visits.filter(item=>item.status==="overdue"):[...tasks,...payments,...reviews,...visits.filter(item=>["overdue","upcoming"].includes(item.status))];
    const needle=query.trim().toLowerCase();
    return selected.filter(item=>!needle||`${item.title} ${item.address} ${item.detail} ${item.status}`.toLowerCase().includes(needle)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  },[data,tab,query]);

  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  const safePage=Math.min(page,pages);
  const visible=items.slice((safePage-1)*pageSize,safePage*pageSize);
  const tabs:{id:Tab;label:string}[]=[{id:"all",label:"Needs attention"},{id:"return-visits",label:"Return Visits"},{id:"pending-payments",label:"Payments"},{id:"low-reviews",label:"Low Reviews"},{id:"overdue",label:"Overdue"},{id:"upcoming",label:"Needs Booking"},{id:"booked",label:"Booked"},{id:"completed",label:"Completed"}];

  return <AdminShell active="Alerts">
    <div className={styles.shell}>
      <section className={styles.hero}><div className={styles.heroCopy}><i className={styles.bulb}>💡</i><div><span>RESOLUTION HUB</span><h1>Alert Center</h1><p>One searchable queue for properties that need attention. Results come from live Tasks, invoices, feedback and Visits.</p></div></div><button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Refreshing…":"Refresh live data"}</button></section>
      <section className={styles.summary}>
        <button className={tab==="return-visits"?styles.active:""} onClick={()=>setTab("return-visits")}><span>Return Visits</span><strong>{buckets.returnVisits}</strong><small>open work orders</small></button>
        <button className={tab==="pending-payments"?styles.active:""} onClick={()=>setTab("pending-payments")}><span>Payment attention</span><strong>{buckets.payments}</strong><small>open invoices</small></button>
        <button className={tab==="low-reviews"?styles.active:""} onClick={()=>setTab("low-reviews")}><span>Low feedback</span><strong>{buckets.reviews}</strong><small>3 stars or below</small></button>
        <button className={tab==="overdue"?styles.active:""} onClick={()=>setTab("overdue")}><span>Overdue visits</span><strong>{buckets.overdue}</strong><small>scheduled in the past</small></button>
      </section>
      {message&&<div className={styles.message}>{message}</div>}
      <section className={styles.panel}>
        <div className={styles.toolbar}><div className={styles.search}><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search customer, address, issue or status" /></div><nav className={styles.tabs}>{tabs.map(item=><button type="button" key={item.id} className={tab===item.id?styles.active:""} onClick={()=>setTab(item.id)}>{item.label}</button>)}</nav></div>
        <div className={styles.list}>{loading?<div className={styles.empty}><strong>Loading live alerts…</strong></div>:visible.length===0?<div className={styles.empty}><strong>Nothing needs attention in this view.</strong><p>Try another category or search term.</p></div>:visible.map(item=><div className={styles.row} key={`${item.kind}-${item.id}`}><i className={`${styles.icon} ${item.kind==="payment"?styles.payment:item.kind==="feedback"?styles.feedback:item.status==="overdue"?styles.overdue:""}`}>{item.icon}</i><div className={styles.copy}><strong>{item.title}</strong><span>{item.address}</span><small>{item.detail} · {dateLabel(item.date)}</small></div><span className={styles.status}>{item.status}</span><div className={styles.actions}><Link href={item.href}>Open</Link>{item.customerId&&<Link href={`/admin/customers/${item.customerId}`}>Customer</Link>}</div></div>)}</div>
        <div className={styles.pager}><span>{items.length?`${(safePage-1)*pageSize+1}-${Math.min(safePage*pageSize,items.length)} of ${items.length}`:"0 results"}</span><div><button type="button" disabled={safePage<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous</button><button type="button" disabled={safePage>=pages} onClick={()=>setPage(value=>Math.min(pages,value+1))}>Next</button></div></div>
        <div className={styles.legend}>{buckets.booked} booked · {buckets.upcoming} need booking · {buckets.completed} completed in the recent window. Large queues stay paginated instead of expanding the page indefinitely.</div>
      </section>
    </div>
  </AdminShell>;
}
