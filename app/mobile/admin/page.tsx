"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { PremiumMetricCard, PremiumMobileHeader, PremiumMobileNav } from "@/components/mobile/PremiumMobileChrome";
import { loadDailyOperations, type DailyOperations } from "@/lib/services/dailyOperationsService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type MobileAdminData = {
  total: number;
  open: number;
  inProgress: number;
  done: number;
  activeRoutes: number;
  tasksOpen: number;
  urgent: number;
  adminName: string;
  companyName: string;
  tasks: { id: string; title: string; customer: string; address: string; status: string; priority: string }[];
};

const EMPTY_DATA: MobileAdminData = {
  total: 0,
  open: 0,
  inProgress: 0,
  done: 0,
  activeRoutes: 0,
  tasksOpen: 0,
  urgent: 0,
  adminName: "Company Admin",
  companyName: "4Ever Seasons",
  tasks: [],
};

function mapOperations(operations: DailyOperations): Pick<MobileAdminData, "total" | "open" | "inProgress" | "done" | "activeRoutes" | "tasksOpen" | "urgent" | "tasks"> {
  return {
    total: operations.summary.homesTotal,
    open: operations.summary.homesOpen,
    inProgress: operations.summary.homesInProgress,
    done: operations.summary.homesDone,
    activeRoutes: operations.assignees.filter((item) => item.total > 0).length,
    tasksOpen: operations.summary.tasksOpen,
    urgent: operations.summary.urgentTasks,
    tasks: operations.tasks
      .filter((task) => !["completed", "resolved"].includes(task.status))
      .slice(0, 4)
      .map((task) => ({
        id: task.id,
        title: task.title,
        customer: task.customerName,
        address: task.address,
        status: task.status,
        priority: task.priority,
      })),
  };
}

export default function MobileAdminApp() {
  const [data, setData] = useState<MobileAdminData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const [{ data: auth }, operations] = await Promise.all([supabase.auth.getUser(), loadDailyOperations()]);
      let adminName = "Company Admin";
      let companyName = "4Ever Seasons";
      if (auth?.user?.id) {
        const { data: profile } = await supabase.from("profiles").select("full_name,company_id,organizations(name)").eq("id", auth.user.id).maybeSingle();
        const organization = Array.isArray(profile?.organizations) ? profile.organizations[0] : profile?.organizations;
        adminName = profile?.full_name || adminName;
        companyName = organization?.name || companyName;
      }
      setData({ ...EMPTY_DATA, ...mapOperations(operations), adminName, companyName });
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Live operations are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const routeNote = useMemo(() => data.activeRoutes ? `${data.activeRoutes} active route${data.activeRoutes === 1 ? "" : "s"} today` : "No active route yet", [data.activeRoutes]);
  const nav = [
    { id: "home", href: "/mobile/admin", icon: "⌂", label: "Home" },
    { id: "routes", href: "/mobile/admin/routes", icon: "▣", label: "Routes" },
    { id: "tasks", href: "/mobile/admin/tasks", icon: "☑", label: "Tasks" },
    { id: "payments", href: "/mobile/admin/finance", icon: "$", label: "Payments" },
    { id: "more", href: "/mobile/admin/more", icon: "⋮", label: "More" },
  ];

  return (
    <MobileRoleGuard allowed={["admin", "manager"]}>
      <main className="premium-mobile-page">
        <PremiumMobileHeader role="ADMIN" name={data.adminName} subtitle={data.companyName} menuHref="/mobile/admin/more" notificationHref="/mobile/admin/alerts" />
        <section className="premium-mobile-content">
          {error && <p className="mobile-message mobile-error" role="alert">{error}</p>}

          <div className="premium-mobile-metrics">
            <PremiumMetricCard href="/mobile/admin/status/open" icon="☑" label="Today's Jobs" value={loading ? "…" : data.total} note={`${data.open} still open`} />
            <PremiumMetricCard href="/mobile/admin/routes" icon="▣" label="Active Routes" value={loading ? "…" : data.activeRoutes} note={routeNote} />
            <PremiumMetricCard href="/mobile/admin/tasks" icon="!" label="Open Issues" value={loading ? "…" : data.tasksOpen} note={`${data.urgent} urgent`} tone="gold" />
            <PremiumMetricCard href="/mobile/admin/status/done" icon="✓" label="Completed" value={loading ? "…" : data.done} note={`${data.inProgress} in progress`} />
          </div>

          <section className="premium-panel premium-route-banner">
            <div className="premium-route-copy"><span>ROUTE PLANNER</span><h2>Plan. Optimize. Deliver.</h2><p>View today&apos;s routes, assignments and employee progress from the live database.</p><Link className="premium-gold-button" href="/mobile/admin/routes">View Route Planner <b>›</b></Link></div>
            <div className="premium-route-map-art" aria-hidden="true"><span className="premium-route-line"/><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b></div>
          </section>

          <div className="premium-two-column">
            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>RECENT CUSTOMER REQUESTS</small><h2>Needs attention</h2></div><Link href="/mobile/admin/tasks">View all</Link></div>
              <div className="premium-list">
                {data.tasks.length ? data.tasks.map((task) => <Link href="/mobile/admin/tasks" className="premium-list-row" key={task.id}><i>{task.priority === "urgent" ? "!" : "✦"}</i><div><strong>{task.title}</strong><span>{task.customer} · {task.address}</span></div><b className={task.priority === "urgent" ? "gold" : ""}>{task.status.replaceAll("_", " ")}</b></Link>) : <div className="premium-list-row"><i>✓</i><div><strong>No open customer issue</strong><span>The priority queue is clear.</span></div><b>Clear</b></div>}
              </div>
            </section>

            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>OPERATIONS TODAY</small><h2>Live status</h2></div></div>
              <div className="premium-summary-list">
                <div className="premium-summary-item"><i>◷</i><div><span>In progress</span><strong>{data.inProgress}</strong><small>Employees currently working</small></div></div>
                <div className="premium-summary-item"><i>✓</i><div><span>Completed</span><strong>{data.done}</strong><small>Finished visits</small></div></div>
                <div className="premium-summary-item"><i>!</i><div><span>Urgent issues</span><strong>{data.urgent}</strong><small>Requires attention</small></div></div>
              </div>
            </section>
          </div>

          <section className="premium-promo"><div><strong>Grow your business with 4Ever Seasons</strong><span>Customers, routes, service quality and finance stay connected.</span></div><Link href="/mobile/admin/reports">View Analytics</Link></section>
        </section>
        <PremiumMobileNav items={nav} active="home" />
      </main>
    </MobileRoleGuard>
  );
}
