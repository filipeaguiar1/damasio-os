"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DAMASIO_SYNC_EVENT, getEmployeeTasks, getLeads, getNotifications, seedDemoLeads } from "@/lib/storage";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {signOutAccount} from "@/lib/auth/signOut";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";

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
    {href:"/admin/routes",icon:"↗",label:"Routes",detail:"Dispatch crews"},
    {href:"/admin/schedule",icon:"□",label:"Schedule",detail:"Plan the day"},
    {href:"/admin/customers",icon:"◎",label:"Customers",detail:"Homes & contacts"},
    {href:"/admin/tasks",icon:"✓",label:"Tasks",detail:"Return visits"},
    {href:"/admin/notifications",icon:"!",label:"Alerts",detail:`${data.alerts} unread`},
  ];

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
        <div><span>Open</span><strong>{data.open}</strong><small>homes</small></div>
        <div><span>Done</span><strong>{data.done}</strong><small>completed</small></div>
        <div><span>Tasks</span><strong>{data.returnVisits}</strong><small>follow-up</small></div>
        <div><span>Alerts</span><strong>{data.alerts}</strong><small>unread</small></div>
      </section>

      <section className="role-mobile-section">
        <div className="role-mobile-section-head"><div><span>QUICK ACCESS</span><h2>Run the business</h2></div><Link href="/admin">View all</Link></div>
        <div className="role-mobile-action-grid">{actions.map(action=><Link href={action.href} key={action.href}><i>{action.icon}</i><strong>{action.label}</strong><small>{action.detail}</small></Link>)}</div>
      </section>

      <section className="role-mobile-section role-attention-section">
        <div className="role-mobile-section-head"><div><span>PRIORITIES</span><h2>Needs attention</h2></div><Link href="/admin/tasks">All tasks</Link></div>
        {data.tasks.length ? data.tasks.map((task) => (
          <Link className="role-mobile-priority" href="/admin/tasks" key={task.id}><i>!</i><span><strong>{task.title}</strong><small>{task.customer} · {task.address}</small></span><b>›</b></Link>
        )) : (
          <div className="role-mobile-clear"><i>✓</i><span><strong>No return visits open</strong><small>Your priority list is clear.</small></span></div>
        )}
      </section>
      <nav className="role-mobile-bottom" aria-label="Admin navigation"><Link className="active" href="/mobile/admin"><i>⌂</i><span>Home</span></Link><Link href="/admin/schedule"><i>□</i><span>Schedule</span></Link><Link href="/admin/routes"><i>↗</i><span>Routes</span></Link><Link href="/admin/customers"><i>◎</i><span>Customers</span></Link><Link href="/admin"><i>•••</i><span>More</span></Link></nav>
    </main></MobileRoleGuard>
  );
}
