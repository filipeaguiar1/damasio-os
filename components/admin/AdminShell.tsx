"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DAMASIO_SYNC_EVENT, getNotifications, getServiceRequests, markNotificationsRead } from "@/lib/storage";
import { signOutAccount } from "@/lib/auth/signOut";

type NavLink = [label: string, href: string];

const topNav: NavLink[] = [
  ["Operations Studio", "/admin"],
  ["Dispatch & Routes", "/admin/routes"],
  ["Customers", "/admin/customers"],
  ["Work Orders", "/admin/tasks"],
  ["Payments", "/admin/finance"],
  ["Reports", "/admin/performance"],
  ["Inventory", "/admin/expenses"],
  ["Employees", "/admin/employees"],
];

const quickActions: NavLink[] = [
  ["New Work Order", "/admin/tasks/open"],
  ["Add Customer", "/admin/add-client"],
  ["Recommend Service", "/admin/recommend-service"],
  ["Build Route", "/admin/routes?tab=build"],
  ["Request Approval", "/admin/requests"],
  ["Message Center", "/admin/notifications"],
  ["Database Health", "/admin/database"],
];

function navActive(active:string,label:string){
  if(active===label)return true;
  if(label==="Payments"&&active==="Finance")return true;
  if(label==="Dispatch & Routes"&&["Routes","Map"].includes(active))return true;
  if(label==="Work Orders"&&active==="Tasks")return true;
  return false;
}

function BellIcon(){
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function ActionIcon({label}:{label:string}){
  const common={fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const};
  if(label==="New Work Order")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" {...common}/></svg>;
  if(label==="Add Customer")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6" {...common}/></svg>;
  if(label==="Recommend Service")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3 3 5 5.8 5 9a5 5 0 0 1-10 0c0-3.2 2-6 5-9ZM9.5 15.5c1.4-.4 2.7-1.4 3.7-3" {...common}/></svg>;
  if(label==="Build Route")return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2" {...common}/><circle cx="18" cy="6" r="2" {...common}/><path d="M8 18c6 0 2-12 8-12" {...common}/></svg>;
  if(label==="Request Approval")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4h3v14H4V7h3V3ZM8 13l3 3 5-6" {...common}/></svg>;
  if(label==="Message Center")return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H8l-4 4V5Z" {...common}/><path d="M8 9h8M8 13h5" {...common}/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V6M4 18h16M8 15v-4M12 15V8M16 15v-7M20 15V5" {...common}/></svg>;
}

export function AdminShell({ children, active }: { children: React.ReactNode; active: string }) {
  const [unread, setUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const preserved=["Operations Studio","Dashboard","Dispatch & Routes","Routes","Map","Payments","Finance"].includes(active);

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
    <div className={`studio-shell ${preserved?"admin-layout-preserved":"admin-layout-refresh"}`}>
      <header className="studio-topnav">
        <Link href="/admin" className="studio-brand" aria-label="4Ever Seasons admin">
          <Image src="/brand/4ever-seasons-logo-mark.jpg" alt="" width={40} height={40} priority />
          <div><span>4Ever Seasons</span><small>Operations Studio</small></div>
        </Link>
        <nav className="studio-nav" aria-label="Admin navigation">
          {topNav.map(([label, href]) => (
            <Link key={href} href={href} className={navActive(active,label)?"active":""}>{label}</Link>
          ))}
        </nav>
        <Link href="/admin/alerts" onClick={openNotifications} className="studio-icon" aria-label="Alerts"><span className="studio-alert-bulb" aria-hidden="true"><BellIcon/></span>{unread > 0 && <b>{unread}</b>}</Link>
        <Link href="/admin/settings" className="studio-user"><span>AD</span><div><strong>Company Admin</strong><small>Administrator</small></div></Link>
        <button type="button" className="studio-signout" onClick={() => void signOutAccount()}>Sign out</button>
        <button type="button" className="studio-menu" onClick={() => setMobileMenuOpen(true)}>Menu</button>
      </header>
      <aside className={`studio-rail ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
        <button type="button" className="mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">x</button>
        <strong>Quick Actions</strong>
        <nav>{quickActions.map(([label, href], index) => <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={index === 0 ? "primary" : ""}><span className="quick-action-icon"><ActionIcon label={label}/></span><strong className="quick-action-label">{label}</strong></Link>)}</nav>
        <section className="studio-rail-summary"><span>Today</span><div><small>Pending Requests</small><b>{pendingRequests}</b></div><div><small>Unread Alerts</small><b>{unread}</b></div></section>
        <Link href="/admin/production" className="studio-system-status"><i></i><span>System Status</span><small>Production checklist</small></Link>
        <section className="studio-rail-filler" aria-label="Workspace status"><div><small>Workspace</small><strong>Company isolated</strong></div><p>Admin tools use company-scoped data so each company stays separated.</p><Link href="/admin/saas">Tenant readiness</Link></section>
      </aside>
      <main className="studio-main">{children}</main>
      <footer className="studio-bottom-status"><span><i></i> Live sync active</span><span>{pendingRequests} approvals waiting</span><span>{unread} unread alerts</span><Link href="/admin/finance">Payments queue</Link></footer>
      <nav className="mobile-shell-bottom" aria-label="Admin subpage navigation">
        <Link className={active === "Dashboard" || active === "Operations Studio" ? "active" : ""} href="/admin"><i>H</i><span>Home</span></Link>
        <Link href="/admin/routes?tab=build"><i>B</i><span>Build</span></Link>
        <Link className={active === "Routes" || active === "Dispatch & Routes" || active === "Map" ? "active" : ""} href="/admin/routes"><i>R</i><span>Routes</span></Link>
        <Link className={active === "Tasks" ? "active" : ""} href="/admin/tasks/open"><i>!</i><span>Tasks</span></Link>
        <button type="button" onClick={() => setMobileMenuOpen(true)}><i>...</i><span>More</span></button>
      </nav>
      <style jsx global>{`
        .studio-topnav{min-width:0!important}
        .studio-brand,.studio-user,.studio-nav{min-width:0!important}
        .studio-nav{max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;overscroll-behavior-x:contain;scrollbar-width:thin;white-space:nowrap}
        .studio-nav>a{flex:0 0 auto!important;white-space:nowrap!important;max-width:none!important}
        .studio-alert-bulb{display:grid;place-items:center;line-height:1}
        .studio-alert-bulb:before{content:none!important}
        .studio-alert-bulb svg{display:block}
        .quick-action-icon svg{width:17px;height:17px;display:block}
        .studio-icon{color:#f4f7f5!important;background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.16)!important}
        .studio-icon:hover{background:rgba(255,255,255,.14)!important}
        .desktop-route-modes{min-width:0!important;max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;flex-wrap:nowrap!important;scrollbar-width:thin}
        .desktop-route-modes>button{flex:0 0 auto!important;white-space:nowrap!important}
        .route-simple-summary>.btn.btn-primary{background:#fbfffc!important;color:#075239!important;border:2px solid #d8f0df!important;box-shadow:0 10px 24px rgba(0,0,0,.14)!important;text-shadow:none!important;opacity:1!important}
        .route-simple-summary>.btn.btn-primary:hover{background:#fff!important;color:#053f2d!important}
        .route-simple-summary>.btn.btn-primary:disabled{background:#dcebe3!important;color:#355d4c!important;border-color:#c7dbd0!important;box-shadow:none!important;opacity:1!important}
        .admin-layout-refresh .studio-main :where(.tab-row,.tabs,.filter-tabs,.sub-tabs){max-width:100%;overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap!important;scrollbar-width:thin}
        .admin-layout-refresh .studio-main :where(.tab-row,.tabs,.filter-tabs,.sub-tabs)>*{flex:0 0 auto;white-space:nowrap}
        @media(min-width:901px){.studio-topnav{grid-template-columns:minmax(190px,250px) minmax(0,1fr) 46px minmax(48px,190px) auto!important;column-gap:8px!important}}
        @media(min-width:901px) and (max-width:1260px){.studio-topnav{grid-template-columns:minmax(165px,215px) minmax(0,1fr) 44px 48px!important}.studio-user{width:44px!important;min-width:44px!important;padding:0!important;justify-content:center!important}.studio-user>div,.studio-signout{display:none!important}.studio-brand>div small{display:none!important}}
      `}</style>
    </div>
  );
}
