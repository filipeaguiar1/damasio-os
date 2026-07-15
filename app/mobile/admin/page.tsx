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
    <header className="mobile-topbar"><div className="mobile-brand-mark">D</div><div><strong>{company}</strong><span>{name} · Admin Mobile</span></div><button type="button" className="mobile-user-signout" onClick={()=>void signOutAccount("/mobile/login")}><span>{name.slice(0,1)}</span><small>Sign out</small></button></header>
    {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
    <section className="mobile-hero-card compact"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>Today</strong><span>Live company operations</span></div></div><h1>{data.open} open homes</h1><p>Dispatch, employees and mobile use the same company data.</p></section>
    <section className="mobile-stats-card"><div><span>Open</span><strong>{data.open}</strong><small>today</small></div><div><span>Done</span><strong>{data.done}</strong><small>today</small></div><div><span>Tasks</span><strong>{data.returnVisits}</strong><small>{data.alerts} urgent</small></div></section>
    <section className="mobile-card-list">
      <Link className="mobile-admin-action" href="/admin/command"><strong>Command Center</strong><p>Open the company operations dashboard.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/routes"><strong>Dispatch / Routes</strong><p>Manage assignments and route order.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/tasks"><strong>Return Visits</strong><p>Assign, unassign and resolve tasks.</p><span>›</span></Link>
      <Link className="mobile-admin-action" href="/admin/customers"><strong>Customers</strong><p>Search customer and property data.</p><span>›</span></Link>
    </section>
    <section className="mobile-card-list"><h2 className="mobile-section-title">Needs attention</h2>{data.tasks.length?data.tasks.map(task=><article className="mobile-issue-card" key={task.id}><strong>{task.title}</strong><p>{task.customer}<br/>{task.address}</p><small>Status: {task.status}</small></article>):<div className="mobile-empty"><strong>No return visits open.</strong><p>Your company is all caught up.</p></div>}</section>
  </main></MobileRoleGuard>;
}
