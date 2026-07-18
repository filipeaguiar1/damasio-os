"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {getNotifications,markNotificationsRead,DAMASIO_SYNC_EVENT,getServiceRequests} from "@/lib/storage";
import {signOutAccount} from "@/lib/auth/signOut";

type NavLink=[label:string,href:string,icon:string];
const navGroups:{id:string;label:string;icon:string;links:NavLink[]}[]=[
  {id:"overview",label:"Overview",icon:"▦",links:[["Command","/admin/command","⌂"],["Dashboard","/admin","▦"]]},
  {id:"clients",label:"Clients & Sales",icon:"♙",links:[["CRM","/admin/leads","☲"],["Estimates","/admin/estimates","☷"],["Requests","/admin/requests","＋"],["Referrals","/admin/referrals","↗"],["Customers","/admin/customers","♙"]]},
  {id:"field",label:"Field Operations",icon:"⇄",links:[["Operations","/admin/operations","◎"],["Workflow","/admin/workflow","↻"],["Dispatch & Routes","/admin/schedule","⇄"],["Map","/admin/map","⌖"],["Calendar","/admin/calendar","▣"],["Employees","/admin/employees","♧"]]},
  {id:"business",label:"Business",icon:"$",links:[["Finance","/admin/finance","$"],["Invoices","/admin/invoices","▤"],["Reports","/admin/performance","▥"],["SaaS","/admin/saas","◈"],["AI","/admin/ai","✦"]]},
  {id:"management",label:"Management",icon:"⚙",links:[["Alerts","/admin/alerts","♢"],["Tasks","/admin/tasks","!"],["Mobile","/admin/mobile","▣"],["Settings","/admin/settings","⚙"],["Users","/admin/users","♙"],["Database","/admin/database","▣"]]},
];

export function AdminShell({children,active}:{children:React.ReactNode;active:string}){
  const[unread,setUnread]=useState(0);
  const[pendingRequests,setPendingRequests]=useState(0);
  const[mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const activeGroup=navGroups.find(group=>group.links.some(([label])=>label===active))?.id??"overview";
  const[openGroup,setOpenGroup]=useState(activeGroup);
  function refreshNotifications(){setUnread(getNotifications().filter(n=>!n.read).length);setPendingRequests(getServiceRequests().filter(r=>r.status==="pending").length)}
  function openNotifications(){markNotificationsRead();setUnread(0)}
  useEffect(()=>{refreshNotifications();const on=()=>refreshNotifications();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on)}},[]);
  useEffect(()=>{setOpenGroup(activeGroup)},[activeGroup]);

  return <div className="admin-pro-shell">
    <aside className={`pro-sidebar ${mobileMenuOpen?"mobile-menu-open":""}`}>
      <button type="button" className="mobile-menu-close" onClick={()=>setMobileMenuOpen(false)} aria-label="Close menu">×</button>
      <Link href="/admin" className="season-logo" aria-label="Damasio Seasons dashboard">
        <div className="season-title"><span>DAMASIO</span><strong>SEASONS</strong></div>
        <div className="grass-mask" aria-hidden="true"><span></span><span></span><span></span></div>
        <div className="mower-man" aria-hidden="true"><i className="head"></i><i className="body"></i><i className="leg one"></i><i className="leg two"></i><i className="arm"></i><i className="mower"></i></div>
      </Link>

      <Link href="/admin/settings" className="admin-profile clickable-profile">
        <div className="profile-avatar">FD</div><div><strong>Filipe Damasio</strong><span>Administrator</span></div><b>⌄</b>
      </Link>

      <nav className="pro-nav">
        {navGroups.map(group=>{
          const isOpen=openGroup===group.id;
          const count=group.id==="clients"?pendingRequests:group.id==="management"?unread:0;
          return <section className={`pro-nav-group ${isOpen?"open":""}`} key={group.id}>
            <button type="button" className="pro-nav-group-toggle" aria-expanded={isOpen} onClick={()=>setOpenGroup(isOpen?"":group.id)}>
              <span>{group.icon}</span><strong>{group.label}</strong>{count>0&&<em>{count}</em>}<b>⌄</b>
            </button>
            {isOpen&&<div className="pro-nav-group-links">
              {group.links.map(([label,href,icon])=><Link key={href} href={href} onClick={()=>{if(label==="Alerts")openNotifications();setMobileMenuOpen(false)}} className={active===label?"active":""}><span>{icon}</span>{label}{label==="Alerts"&&unread>0&&<em>{unread}</em>}{label==="Requests"&&pendingRequests>0&&<em>{pendingRequests}</em>}</Link>)}
            </div>}
          </section>
        })}
      </nav>

      <Link href="/admin/alerts?tab=support" className="help-card"><span>☏</span><div><strong>Need Help?</strong><small>Contact Support</small></div></Link>
      <button type="button" className="mobile-menu-signout" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
    </aside>
    <main className="pro-main">
      <header className="pro-topbar">
        <Link href="/mobile/admin" className="mobile-subpage-back" aria-label="Back to admin home">‹</Link>
        <button type="button" className="hamburger mobile-menu-toggle" onClick={()=>setMobileMenuOpen(true)} aria-label="Open menu">☰</button>
        <span className="mobile-subpage-title"><strong>{active}</strong><small>Admin workspace</small></span>
        <Link href="/admin/leads" className="topbar-pill">🌿 Damasio OS V51.3</Link>
        <div className="topbar-spacer"></div>
        <Link href="/admin/customers" className="top-icon" aria-label="Search customers">⌕</Link>
        <Link href="/admin/alerts" onClick={openNotifications} className="top-icon notify" aria-label="Open notifications">♢{unread>0&&<b>{unread}</b>}</Link>
        <Link href="/admin/settings" className="top-icon" aria-label="Theme settings">☾</Link>
        <Link href="/admin/settings" className="mini-user" aria-label="Open profile"><span>FD</span><i></i></Link>
        <button type="button" className="top-signout" onClick={()=>void signOutAccount()} aria-label="Sign out">Sign out</button>
      </header>
      <div className="pro-content">{children}</div>
      <nav className="mobile-shell-bottom" aria-label="Admin subpage navigation">
        <Link href="/mobile/admin"><i>⌂</i><span>Home</span></Link>
        <Link className={active==="Dispatch"||active==="Calendar"?"active":""} href="/admin/schedule"><i>□</i><span>Schedule</span></Link>
        <Link className={active==="Dispatch & Routes"||active==="Map"?"active":""} href="/admin/schedule"><i>↗</i><span>Routes</span></Link>
        <Link className={active==="Tasks"?"active":""} href="/admin/tasks/open"><i>!</i><span>Tasks</span></Link>
        <button type="button" onClick={()=>setMobileMenuOpen(true)}><i>•••</i><span>More</span></button>
      </nav>
    </main>
  </div>
}
