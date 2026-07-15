"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DAMASIO_SYNC_EVENT, getEmployeeTasks, getLeads, getNotifications, seedDemoLeads } from "@/lib/storage";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";

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

  return (
    <MobileRoleGuard allowed={["admin","manager"]}><main className="mobile-app-shell mobile-admin-shell">
      <header className="mobile-topbar">
        <div className="mobile-brand-mark">D</div>
        <div>
          <strong>Admin Mobile</strong>
          <span>Command snapshot</span>
        </div>
        <div className="mobile-avatar">A</div>
      </header>

      <section className="mobile-hero-card compact">
        <div className="mobile-brand-row">
          <div className="mobile-brand-mark">D</div>
          <div>
            <strong>Today</strong>
            <span>Live operations</span>
          </div>
        </div>
        <h1>{data.open} open homes</h1>
        <p>Fast mobile access for Admin. Full editing still opens the existing Admin screens.</p>
      </section>

      <section className="mobile-stats-card">
        <div><span>Open</span><strong>{data.open}</strong><small>homes</small></div>
        <div><span>Done</span><strong>{data.done}</strong><small>today</small></div>
        <div><span>Tasks</span><strong>{data.returnVisits}</strong><small>return</small></div>
      </section>

      <section className="mobile-card-list">
        <Link className="mobile-admin-action" href="/admin/command"><strong>Command Center</strong><p>Open full operations dashboard.</p><span>›</span></Link>
        <Link className="mobile-admin-action" href="/admin/routes"><strong>Dispatch / Routes</strong><p>Manage assignments and route order.</p><span>›</span></Link>
        <Link className="mobile-admin-action" href="/admin/tasks"><strong>Return Visits</strong><p>Assign, unassign and resolve tasks.</p><span>›</span></Link>
        <Link className="mobile-admin-action" href="/admin/customers"><strong>Customers</strong><p>Search customer and property data.</p><span>›</span></Link>
      </section>

      <section className="mobile-card-list">
        <h2 className="mobile-section-title">Needs attention</h2>
        {data.tasks.length ? data.tasks.map((task) => (
          <article className="mobile-issue-card" key={task.id}>
            <strong>{task.title}</strong>
            <p>{task.customer}<br />{task.address}</p>
            <small>Status: {task.status}</small>
          </article>
        )) : (
          <div className="mobile-empty"><strong>No return visits open.</strong><p>Admin mobile is working and ready for live data.</p></div>
        )}
      </section>
    </main></MobileRoleGuard>
  );
}
