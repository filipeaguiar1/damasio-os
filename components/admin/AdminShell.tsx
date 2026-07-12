"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {getNotifications,markNotificationsRead,DAMASIO_SYNC_EVENT,getServiceRequests} from "@/lib/storage";

const links=[
  ["Command","/admin/command","⌂"],
  ["Dashboard","/admin","▦"],
  ["CRM","/admin/leads","☲"],
  ["Estimates","/admin/estimates","☷"],
  ["Requests","/admin/requests","＋"],
  ["Customers","/admin/customers","♙"],
  ["Operations","/admin/operations","◎"],
  ["Workflow","/admin/workflow","↻"],
  ["Dispatch","/admin/schedule","⇄"],
  ["Routes","/admin/routes","⌘"],
  ["Map","/admin/map","⌖"],
  ["Calendar","/admin/calendar","▣"],
  ["Crews","/admin/employees","♧"],
  ["Finance","/admin/finance","$"],
  ["SaaS","/admin/saas","◈"],
  ["AI","/admin/ai","✦"],
  ["Mobile","/admin/mobile","▣"],
  ["Invoices","/admin/invoices","▤"],
  ["Alerts","/admin/alerts","♢"],
  ["Tasks","/admin/tasks","!"],
  ["Reports","/admin/performance","▥"],
  ["Settings","/admin/settings","⚙"],
  ["Users","/admin/users","♙"],
  ["Database","/admin/database","▣"],
];

export function AdminShell({children,active}:{children:React.ReactNode;active:string}){
  const[unread,setUnread]=useState(0);
  const[pendingRequests,setPendingRequests]=useState(0);
  function refreshNotifications(){setUnread(getNotifications().filter(n=>!n.read).length);setPendingRequests(getServiceRequests().filter(r=>r.status==="pending").length)}
  function openNotifications(){markNotificationsRead();setUnread(0)}
  useEffect(()=>{refreshNotifications();const on=()=>refreshNotifications();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);

  return <div className="admin-pro-shell">
    <aside className="pro-sidebar">
      <Link href="/admin" className="season-logo" aria-label="Damasio Seasons dashboard">
        <div className="season-title"><span>DAMASIO</span><strong>SEASONS</strong></div>
        <div className="grass-mask" aria-hidden="true"><span></span><span></span><span></span></div>
        <div className="mower-man" aria-hidden="true"><i className="head"></i><i className="body"></i><i className="leg one"></i><i className="leg two"></i><i className="arm"></i><i className="mower"></i></div>
      </Link>

      <Link href="/admin/settings" className="admin-profile clickable-profile">
        <div className="profile-avatar">FD</div><div><strong>Filipe Damasio</strong><span>Administrator</span></div><b>⌄</b>
      </Link>

      <nav className="pro-nav">
        {links.map(([label,href,icon])=><Link key={href} href={href} onClick={label==="Alerts"?openNotifications:undefined} className={active===label?"active":""}><span>{icon}</span>{label}{label==="Alerts"&&unread>0&&<em>{unread}</em>}{label==="Requests"&&pendingRequests>0&&<em>{pendingRequests}</em>}</Link>)}
      </nav>

      <Link href="/admin/alerts?tab=support" className="help-card"><span>☏</span><div><strong>Need Help?</strong><small>Contact Support</small></div></Link>
    </aside>
    <main className="pro-main">
      <header className="pro-topbar">
        <Link href="/admin" className="hamburger" aria-label="Open dashboard">☰</Link>
        <Link href="/admin/leads" className="topbar-pill">🌿 Damasio OS V51.3</Link>
        <div className="topbar-spacer"></div>
        <Link href="/admin/customers" className="top-icon" aria-label="Search customers">⌕</Link>
        <Link href="/admin/alerts" onClick={openNotifications} className="top-icon notify" aria-label="Open notifications">♢{unread>0&&<b>{unread}</b>}</Link>
        <Link href="/admin/settings" className="top-icon" aria-label="Theme settings">☾</Link>
        <Link href="/admin/settings" className="mini-user" aria-label="Open profile"><span>FD</span><i></i></Link>
      </header>
      <div className="pro-content">{children}</div>
    </main>
  </div>
}
