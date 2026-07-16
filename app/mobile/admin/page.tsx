"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DAMASIO_SYNC_EVENT, getEmployeeTasks, getLeads, getNotifications, seedDemoLeads } from "@/lib/storage";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {signOutAccount} from "@/lib/auth/signOut";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";
import {MobileAdminNav} from "@/components/mobile/MobileAdminNav";

type MobileAdminData = {
  open: number;
  done: number;
  returnVisits: number;
  alerts: number;
  tasks: { id: string; title: string; customer: string; address: string; status: string }[];
};

const EMPTY_DATA: MobileAdminData = { open: 0, done: 0, returnVisits: 0, alerts: 0, tasks: [] };

function readAdminData(): MobileAdminData {
  try {
    const leads = getLeads();
    const tasks = getEmployeeTasks();
    const notes = getNotifications();
    return {
      open: leads.filter((lead) => lead.status !== "completed").length,
      done: leads.filter((lead) => lead.status === "completed").length,
      returnVisits: tasks.filter((task) => task.status !== "resolved").length,
      alerts: notes.filter((note) => !note.read).length,
      tasks: tasks
        .filter((task) => task.status !== "resolved")
        .slice(0, 5)
        .map((task) => ({
          id: task.id,
          title: task.title,
          customer: task.customer,
          address: task.address,
          status: task.status,
        })),
    };
  } catch {
    return EMPTY_DATA;
  }
}

export default function MobileAdminApp() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionPage,setActionPage]=useState(0);
  const actionScroller=useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      seedDemoLeads();
    } catch {
      // Mobile Admin must always open, even if local demo data is unavailable.
    }

    const refresh = () => setRefreshKey((value) => value + 1);
    window.addEventListener(DAMASIO_SYNC_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(refresh, 5000);

    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
      window.clearInterval(timer);
    };
  }, []);

  const data = useMemo(() => {
    refreshKey;
    return readAdminData();
  }, [refreshKey]);

  const actions=[
    {href:"/admin/command",icon:"⌁",label:"Command",detail:"Live operation"},
    {href:"/mobile/admin/routes",icon:"↗",label:"Routes",detail:"Dispatch crews"},
    {href:"/admin/schedule",icon:"□",label:"Schedule",detail:"Plan the day"},
    {href:"/admin/customers",icon:"◎",label:"Customers",detail:"Homes & contacts"},
    {href:"/mobile/admin/tasks",icon:"✓",label:"Tasks",detail:"Return visits"},
    {href:"/mobile/admin/alerts",icon:"!",label:"Alerts",detail:`${data.alerts} unread`},
    {href:"/admin/estimates",icon:"▤",label:"Estimates",detail:"Quotes & approvals"},
    {href:"/admin/invoices",icon:"$",label:"Invoices",detail:"Billing status"},
    {href:"/admin/requests",icon:"＋",label:"Requests",detail:"Customer needs"},
    {href:"/admin/employees",icon:"♧",label:"Employees",detail:"Team & crews"},
    {href:"/admin/finance",icon:"◈",label:"Finance",detail:"Revenue & costs"},
    {href:"/admin/performance",icon:"▥",label:"Reports",detail:"Business results"},
  ];
  const actionPages=[actions.slice(0,6),actions.slice(6,12)];

  function goToActionPage(index:number){
    const scroller=actionScroller.current;
    if(!scroller)return;
    scroller.scrollTo({left:scroller.clientWidth*index,behavior:"smooth"});
    setActionPage(index);
  }

  return (
    <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell role-mobile-shell role-admin-mobile">
      <header className="role-mobile-topbar">
        <MobileBackButton/>
        <div><strong>Operations</strong><span>Admin workspace</span></div>
        <button type="button" className="role-mobile-avatar" onClick={()=>void signOutAccount("/mobile/login")} aria-label="Sign out">A</button>
      </header>

      <section className="mobile-hero-card compact">
        <span className="role-mobile-eyebrow">TODAY · LIVE OPERATIONS</span>
        <h1>Everything under control.</h1>
        <p><strong>{data.open} homes</strong> are open and {data.returnVisits} tasks need follow-up.</p>
        <Link className="role-mobile-hero-link" href="/admin/command">Open Command Center <span>→</span></Link>
      </section>

      <section className="mobile-stats-card">
        <Link href="/mobile/admin/routes"><span>Open</span><strong>{data.open}</strong><small>homes</small></Link>
        <Link href="/mobile/admin/routes"><span>Done</span><strong>{data.done}</strong><small>completed</small></Link>
        <Link href="/mobile/admin/tasks"><span>Tasks</span><strong>{data.returnVisits}</strong><small>follow-up</small></Link>
        <Link href="/mobile/admin/alerts"><span>Alerts</span><strong>{data.alerts}</strong><small>unread</small></Link>
      </section>

      <section className="role-mobile-section">
        <div className="role-mobile-section-head"><div><span>QUICK ACCESS</span><h2>Run the business</h2></div><small>{actionPage+1} / {actionPages.length}</small></div>
        <div className="role-mobile-action-pages" ref={actionScroller} onScroll={event=>{const width=event.currentTarget.clientWidth;if(width)setActionPage(Math.round(event.currentTarget.scrollLeft/width))}}>
          {actionPages.map((page,index)=><div className="role-mobile-action-grid" key={index}>{page.map(action=><Link href={action.href} key={action.href}><i>{action.icon}</i><strong>{action.label}</strong><small>{action.detail}</small></Link>)}</div>)}
        </div>
        <div className="role-mobile-dots" aria-label="Quick access pages">{actionPages.map((_,index)=><button type="button" key={index} className={actionPage===index?"active":""} onClick={()=>goToActionPage(index)} aria-label={`Open quick access page ${index+1}`}/>)}</div>
      </section>

      <section className="role-mobile-section role-attention-section">
        <div className="role-mobile-section-head"><div><span>PRIORITIES</span><h2>Needs attention</h2></div><Link href="/mobile/admin/tasks">All tasks</Link></div>
        {data.tasks.length ? data.tasks.map((task) => (
          <Link className="role-mobile-priority" href="/mobile/admin/tasks" key={task.id}><i>!</i><span><strong>{task.title}</strong><small>{task.customer} · {task.address}</small></span><b>›</b></Link>
        )) : (
          <div className="role-mobile-clear"><i>✓</i><span><strong>No return visits open</strong><small>Your priority list is clear.</small></span></div>
        )}
      </section>
      <MobileAdminNav active="home"/>
    </main></MobileRoleGuard>
  );
}
