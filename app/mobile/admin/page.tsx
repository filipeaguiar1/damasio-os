"use client";

import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {signOutAccount} from "@/lib/auth/signOut";
import {readDemoSession} from "@/lib/auth/demoAuth";
import {useMobileRealtime} from "@/lib/mobile/useMobileRealtime";
import type {SchedulingDispatchBoard} from "@/lib/repositories/schedulingRepository";
import {loadSchedulingDispatchBoard} from "@/lib/services/schedulingService";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";
import {DAMASIO_SYNC_EVENT,getEmployeeTasks,getLeads,getNotifications,seedDemoLeads} from "@/lib/storage";

type MobileAdminData={open:number;done:number;returnVisits:number;alerts:number;tasks:{id:string;title:string;customer:string;address:string;status:string}[]};
type AdminTab="home"|"operations"|"tasks"|"account";
const EMPTY_DATA:MobileAdminData={open:0,done:0,returnVisits:0,alerts:0,tasks:[]};
const localDate=()=>new Date().toLocaleDateString("en-CA");

function fromBoard(board:SchedulingDispatchBoard):MobileAdminData{
  const today=localDate();
  const visits=board.visits.filter(visit=>visit.scheduledDate===today);
  const tasks=board.tasks.filter(task=>task.status!=="resolved"&&task.status!=="cancelled");
  return{
    open:visits.filter(visit=>visit.status==="scheduled"||visit.status==="in_progress").length,
    done:visits.filter(visit=>visit.status==="completed").length,
    returnVisits:tasks.length,
    alerts:tasks.filter(task=>task.priority==="urgent").length,
    tasks:tasks.slice(0,5).map(task=>({id:task.id,title:task.title,customer:task.customerName||"Customer",address:task.address||"Address pending",status:task.status}))
  };
}

function readDemoData():MobileAdminData{
  try{
    seedDemoLeads();
    const leads=getLeads();const tasks=getEmployeeTasks();const notes=getNotifications();
    return{open:leads.filter(lead=>lead.status!=="completed").length,done:leads.filter(lead=>lead.status==="completed").length,returnVisits:tasks.filter(task=>task.status!=="resolved").length,alerts:notes.filter(note=>!note.read).length,tasks:tasks.filter(task=>task.status!=="resolved").slice(0,5).map(task=>({id:task.id,title:task.title,customer:task.customer,address:task.address,status:task.status}))};
  }catch{return EMPTY_DATA}
}

export default function MobileAdminApp(){
  const[data,setData]=useState(EMPTY_DATA);
  const[name,setName]=useState("Admin");
  const[company,setCompany]=useState("Company operations");
  const[error,setError]=useState("");
  const[tab,setTab]=useState<AdminTab>("home");
  const demo=readDemoSession();

  const refresh=useCallback(async()=>{
    if(demo||!isSupabaseConfigured()){setData(readDemoData());setName(demo?.name||"Admin");setCompany(demo?.companyName||"Company operations");return}
    try{
      const client=getSupabaseBrowserClient() as any;
      const[{data:auth},board]=await Promise.all([client.auth.getUser(),loadSchedulingDispatchBoard({force:true})]);
      setData(fromBoard(board));
      if(auth?.user?.id){
        const{data:profile}=await client.from("profiles").select("full_name,company_id,organization_id").eq("id",auth.user.id).maybeSingle();
        setName(profile?.full_name||"Admin");
        const companyId=profile?.company_id||profile?.organization_id;
        if(companyId){const{data:organization}=await client.from("organizations").select("name").eq("id",companyId).maybeSingle();setCompany(organization?.name||"Company operations")}
      }
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"Live operations are temporarily unavailable.")}
  },[demo?.email]);

  useMobileRealtime(()=>void refresh());
  useEffect(()=>{void refresh();const on=()=>void refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[refresh]);

  return <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell mobile-admin-shell">
    <header className="mobile-topbar mobile-compact-topbar"><div className="mobile-brand-mark">D</div><div><strong>{company}</strong><span>{name} · Admin</span></div><button type="button" className="mobile-profile-button" onClick={()=>setTab("account")} aria-label="Open account">{name.slice(0,1)}</button></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    {tab==="home"&&<div className="mobile-tab-panel"><section className="mobile-compact-summary"><div><span>Today</span><strong>{data.open} open homes</strong><small>Live company operations</small></div><button onClick={()=>setTab("operations")}>Manage</button></section><section className="mobile-stats-card"><div><span>Open</span><strong>{data.open}</strong><small>today</small></div><div><span>Done</span><strong>{data.done}</strong><small>today</small></div><div><span>Tasks</span><strong>{data.returnVisits}</strong><small>{data.alerts} urgent</small></div></section><section className="mobile-quick-grid"><button onClick={()=>setTab("operations")}><span>⌖</span><strong>Routes</strong><small>Dispatch</small></button><button onClick={()=>setTab("tasks")}><span>!</span><strong>Tasks</strong><small>{data.returnVisits} open</small></button><Link href="/admin/customers"><span>⌂</span><strong>Customers</strong><small>Directory</small></Link><Link href="/admin/schedule"><span>▦</span><strong>Schedule</strong><small>Calendar</small></Link></section></div>}
    {tab==="operations"&&<section className="mobile-tab-panel mobile-card-list"><div className="mobile-panel-heading"><div><span>Company tools</span><h1>Operations</h1></div><small>Choose an area</small></div><Link className="mobile-admin-action" href="/admin/command"><strong>Command Center</strong><p>Today’s complete operations dashboard.</p><span>›</span></Link><Link className="mobile-admin-action" href="/admin/routes"><strong>Dispatch / Routes</strong><p>Assignments, crews and route order.</p><span>›</span></Link><Link className="mobile-admin-action" href="/admin/schedule"><strong>Schedule</strong><p>Week, visits and availability.</p><span>›</span></Link><Link className="mobile-admin-action" href="/admin/customers"><strong>Customers</strong><p>Customer and property information.</p><span>›</span></Link></section>}
    {tab==="tasks"&&<section className="mobile-tab-panel mobile-card-list"><div className="mobile-panel-heading"><div><span>Needs attention</span><h1>Tasks</h1></div><Link href="/admin/tasks">Open all</Link></div>{data.tasks.length?data.tasks.map(task=><article className="mobile-issue-card" key={task.id}><strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>Status: {task.status}</small></article>):<div className="mobile-empty"><strong>No return visits open.</strong><p>Your company is all caught up.</p></div>}</section>}
    {tab==="account"&&<section className="mobile-tab-panel"><div className="mobile-account-card"><span>{name.slice(0,1)}</span><h1>{name}</h1><p>{company}</p><small>Company Administrator</small><button type="button" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button></div></section>}
    <nav className="mobile-bottom-nav" aria-label="Admin mobile navigation"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><span>⌂</span><small>Home</small></button><button className={tab==="operations"?"active":""} onClick={()=>setTab("operations")}><span>▦</span><small>Manage</small></button><button className={tab==="tasks"?"active":""} onClick={()=>setTab("tasks")}><span>!</span><small>Tasks</small>{data.returnVisits>0&&<b>{data.returnVisits}</b>}</button><button className={tab==="account"?"active":""} onClick={()=>setTab("account")}><span>○</span><small>Account</small></button></nav>
  </main></MobileRoleGuard>;
}
