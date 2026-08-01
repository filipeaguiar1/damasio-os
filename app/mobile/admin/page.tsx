"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { signOutAccount } from "@/lib/auth/signOut";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileAdminNav } from "@/components/mobile/MobileAdminNav";
import { loadDailyOperations, type DailyOperations } from "@/lib/services/dailyOperationsService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type MobileAdminData = {open:number;done:number;returnVisits:number;alerts:number;tasks:{id:string;title:string;customer:string;address:string;status:string}[]};
type InboxTask={id:string;kind:string;serviceName:string;customerName:string;address:string;status:string;priority:string|null};
type InboxPayload={requests?:InboxTask[];summary?:{pendingTaskCount?:number}};
const EMPTY_DATA:MobileAdminData={open:0,done:0,returnVisits:0,alerts:0,tasks:[]};
function mapOperations(operations:DailyOperations):MobileAdminData{return{open:operations.summary.homesOpen,done:operations.summary.homesDone,returnVisits:operations.summary.tasksOpen,alerts:operations.summary.urgentTasks,tasks:operations.tasks.filter(task=>!["completed","resolved"].includes(task.status)).slice(0,5).map(task=>({id:task.id,title:task.title,customer:task.customerName,address:task.address,status:task.status}))}}
async function loadInbox():Promise<InboxPayload>{const{data}=await getSupabaseBrowserClient().auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Your Admin session expired. Sign in again.");const response=await fetch("/api/admin/service-requests",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Customer tasks could not be loaded.");return result}

export default function MobileAdminApp(){
 const[data,setData]=useState<MobileAdminData>(EMPTY_DATA),[loading,setLoading]=useState(true),[error,setError]=useState(""),[actionPage,setActionPage]=useState(0);const actionScroller=useRef<HTMLDivElement>(null);
 async function refresh(){try{const[operations,inbox]=await Promise.all([loadDailyOperations(),loadInbox()]);const mapped=mapOperations(operations);const openStatuses=new Set(["pending","open","assigned","in_progress"]);const inboxTasks=(inbox.requests||[]).filter(item=>item.kind==="customer_task"&&openStatuses.has(item.status));const mergedTasks=inboxTasks.map(item=>({id:item.id,title:item.serviceName,customer:item.customerName,address:item.address,status:item.status}));setData({...mapped,returnVisits:Number(inbox.summary?.pendingTaskCount??inboxTasks.length),alerts:Math.max(mapped.alerts,inboxTasks.filter(item=>item.priority==="urgent").length),tasks:mergedTasks.slice(0,5)});setError("")}catch(nextError){setData(EMPTY_DATA);setError(nextError instanceof Error?nextError.message:"Live operations are temporarily unavailable.")}finally{setLoading(false)}}
 useEffect(()=>{void refresh();const client=getSupabaseBrowserClient() as any;const channel=client.channel("mobile-admin-home-tasks").on("postgres_changes",{event:"*",schema:"public",table:"tasks"},()=>void refresh()).subscribe();const timer=window.setInterval(()=>void refresh(),5000);const focus=()=>void refresh();window.addEventListener("focus",focus);return()=>{window.clearInterval(timer);window.removeEventListener("focus",focus);void client.removeChannel(channel)}},[]);
 const actions=[
  {href:"/mobile/admin/command",icon:"⌁",label:"Command",detail:"Live operation"},
  {href:"/mobile/admin/routes",icon:"↗",label:"Routes",detail:"Real Employee routes"},
  {href:"/mobile/admin/schedule",icon:"□",label:"Schedule",detail:"Canonical visits"},
  {href:"/mobile/admin/customers",icon:"◎",label:"Customers",detail:"Homes & contacts"},
  {href:"/mobile/admin/tasks",icon:"✓",label:"Tasks",detail:`${data.returnVisits} pending`},
  {href:"/mobile/admin/alerts",icon:"!",label:"Alerts",detail:`${data.alerts} urgent`},
  {href:"/mobile/admin/estimates",icon:"▤",label:"Estimates",detail:"Quotes & approvals"},
  {href:"/mobile/admin/requests",icon:"＋",label:"Requests",detail:`${data.returnVisits} tasks pending`},
  {href:"/mobile/admin/employees",icon:"♧",label:"Employees",detail:"Real company users"},
  {href:"/mobile/admin/finance",icon:"$",label:"Payments",detail:"Payments & visits"},
 ];
 const actionPages=[actions.slice(0,5),actions.slice(5,10)];
 function goToActionPage(index:number){const scroller=actionScroller.current;if(!scroller)return;scroller.scrollTo({left:scroller.clientWidth*index,behavior:"smooth"});setActionPage(index)}
 return <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell role-mobile-shell role-admin-mobile"><header className="role-mobile-topbar"><MobileBackButton/><div><strong>Operations</strong><span>Admin workspace</span></div><button type="button" className="role-mobile-avatar" onClick={()=>void signOutAccount("/mobile/login")} aria-label="Sign out">A</button></header>
 {error&&<p className="mobile-message mobile-error" role="alert">{error}</p>}
 <section className="mobile-hero-card compact"><span className="role-mobile-eyebrow">TODAY · LIVE DATABASE</span><h1>{loading?"Loading live operations...":"Everything under control."}</h1><p><strong>{data.open} homes</strong> are open and {data.returnVisits} tasks need follow-up.</p><Link className="role-mobile-hero-link" href="/mobile/admin/requests">Open customer requests <span>→</span></Link></section>
 <section className="mobile-stats-card"><Link href="/mobile/admin/status/open"><span>Open</span><strong>{data.open}</strong><small>homes</small></Link><Link href="/mobile/admin/status/done"><span>Done</span><strong>{data.done}</strong><small>completed</small></Link><Link href="/mobile/admin/requests"><span>Tasks</span><strong>{data.returnVisits}</strong><small>pending</small></Link><Link href="/mobile/admin/alerts"><span>Alerts</span><strong>{data.alerts}</strong><small>urgent</small></Link></section>
 <section className="role-mobile-section"><div className="role-mobile-section-head"><div><span>QUICK ACCESS</span><h2>Run the business</h2></div><small>{actionPage+1} / {actionPages.length}</small></div><div className="role-mobile-action-pages" ref={actionScroller} onScroll={event=>{const width=event.currentTarget.clientWidth;if(width)setActionPage(Math.round(event.currentTarget.scrollLeft/width))}}>{actionPages.map((page,index)=><div className="role-mobile-action-grid" key={index}>{page.map(action=><Link href={action.href} key={action.href}><i>{action.icon}</i><strong>{action.label}</strong><small>{action.detail}</small></Link>)}</div>)}</div><div className="role-mobile-dots" aria-label="Quick access pages">{actionPages.map((_,index)=><button type="button" key={index} className={actionPage===index?"active":""} onClick={()=>goToActionPage(index)} aria-label={`Open quick access page ${index+1}`}/>)}</div></section>
 <section className="role-mobile-section role-attention-section"><div className="role-mobile-section-head"><div><span>PRIORITIES</span><h2>Needs attention</h2></div><Link href="/mobile/admin/requests">All tasks</Link></div>{data.tasks.length?data.tasks.map(task=><Link className="role-mobile-priority" href="/mobile/admin/requests" key={task.id}><i>!</i><span><strong>{task.title}</strong><small>{task.customer} · {task.address}</small></span><b>›</b></Link>):<div className="role-mobile-clear"><i>✓</i><span><strong>No customer tasks open</strong><small>Your priority list is clear.</small></span></div>}</section>
 <MobileAdminNav active="home"/></main></MobileRoleGuard>
}
