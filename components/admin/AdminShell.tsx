"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DAMASIO_SYNC_EVENT, getNotifications, getServiceRequests, markNotificationsRead } from "@/lib/storage";
import { signOutAccount } from "@/lib/auth/signOut";

type NavLink = [label: string, href: string];

const topNav: NavLink[] = [
  ["Operations Studio", "/admin"],
  ["Dashboard", "/admin/command"],
  ["Dispatch & Routes", "/admin/routes"],
  ["Customers", "/admin/customers"],
  ["Work Orders", "/admin/tasks"],
  ["Billing", "/admin/finance"],
  ["Reports", "/admin/performance"],
  ["Inventory", "/admin/expenses"],
  ["Employees", "/admin/employees"],
];

const quickActions: NavLink[] = [
  ["New Work Order", "/admin/tasks/open"],
  ["Add Customer", "/admin/add-client"],
  ["Recommend Service", "/admin/recommend-service"],
  ["Routes", "/admin/routes"],
  ["Request Approval", "/admin/requests"],
  ["Message Center", "/admin/notifications"],
  ["Database Health", "/admin/database"],
];

export function AdminShell({ children, active }: { children: React.ReactNode; active: string }) {
  const [unread, setUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function refreshNotifications() {
    setUnread(getNotifications().filter((notification) => !notification.read).length);
    setPendingRequests(getServiceRequests().filter((request) => request.status === "pending").length);
  }

  function openNotifications() {
    markNotificationsRead();
    setUnread(0);
  }

  useEffect(() => {
    refreshNotifications();
    const onSync = () => refreshNotifications();
    window.addEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
    window.addEventListener("storage", onSync);
    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
      window.removeEventListener("storage", onSync);
    };
  }, []);

  return (
    <div className="studio-shell">
      <header className="studio-topnav">
        <Link href="/admin" className="studio-brand" aria-label="4Ever Seasons admin">
          <Image src="/brand/4ever-seasons-logo-mark.jpg" alt="" width={40} height={40} priority />
          <div>
            <span>4EVER SEASONS</span>
            <small>Operations Studio</small>
          </div>
        </Link>
        <nav className="studio-nav" aria-label="Admin navigation">
          {topNav.map(([label, href]) => (
            <Link key={href} href={href} className={active === label || (label === "Dispatch & Routes" && active === "Routes") || (label === "Operations Studio" && active === "Dashboard") ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        <Link href="/admin/alerts" onClick={openNotifications} className="studio-icon" aria-label="Notifications">
          N{unread > 0 && <b>{unread}</b>}
        </Link>
        <Link href="/admin/settings" className="studio-user"><span>FD</span><div><strong>Mike Admin</strong><small>Administrator</small></div></Link>
        <button type="button" className="studio-signout" onClick={() => void signOutAccount()}>Sign out</button>
        <button type="button" className="studio-menu" onClick={() => setMobileMenuOpen(true)}>Menu</button>
      </header>
      <aside className={`studio-rail ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
        <button type="button" className="mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">x</button>
        <strong>Quick Actions</strong>
        <nav>
          {quickActions.map(([label, href], index) => (
            <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={index === 0 ? "primary" : ""}>
              <span>{index === 0 ? "+" : String(index)}</span>{label}
            </Link>
          ))}
        </nav>
        <section className="studio-rail-summary">
          <span>Today</span>
          <div><small>Pending Requests</small><b>{pendingRequests}</b></div>
          <div><small>Unread Alerts</small><b>{unread}</b></div>
        </section>
        <Link href="/admin/production" className="studio-system-status">
          <i></i><span>System Status</span><small>Production checklist</small>
        </Link>
        <section className="studio-rail-filler" aria-label="Workspace status">
          <div>
            <small>Workspace</small>
            <strong>Company isolated</strong>
          </div>
          <p>Admin tools are being wired through company-scoped data so each company stays separated.</p>
          <Link href="/admin/saas">Tenant readiness</Link>
        </section>
      </aside>
      <main className="studio-main">{children}</main>
      <footer className="studio-bottom-status">
        <span><i></i> Live sync active</span>
        <span>{pendingRequests} approvals waiting</span>
        <span>{unread} unread alerts</span>
        <Link href="/admin/finance">Finance queue</Link>
      </footer>
      <nav className="mobile-shell-bottom" aria-label="Admin subpage navigation">
        <Link href="/mobile/admin"><i>H</i><span>Home</span></Link>
        <Link className={active === "Dispatch" || active === "Calendar" ? "active" : ""} href="/admin/schedule"><i>S</i><span>Schedule</span></Link>
        <Link className={active === "Routes" || active === "Dispatch & Routes" || active === "Map" ? "active" : ""} href="/admin/routes"><i>R</i><span>Routes</span></Link>
        <Link className={active === "Tasks" ? "active" : ""} href="/admin/tasks/open"><i>!</i><span>Tasks</span></Link>
        <button type="button" onClick={() => setMobileMenuOpen(true)}><i>...</i><span>More</span></button>
      </nav>
    </div>
  );
}
