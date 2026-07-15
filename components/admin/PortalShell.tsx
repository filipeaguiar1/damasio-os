"use client";
import {useState} from "react";
import Link from "next/link";
import {signOutAccount} from "@/lib/auth/signOut";

export function PortalShell({children,active,type}:{children:React.ReactNode;active:string;type:"Customer"|"Employee"}){
  const base=type==="Customer"?"/customer":"/employee";
  const links=type==="Customer"
    ?[["Dashboard",base,"⌂"],["Services",base+"/services","▣"],["Service Issues",base+"/tasks","!"],["History",base+"/history","◷"],["Estimates",base+"/estimates","☷"],["Invoices",base+"/invoices","▤"],["Payments",base+"/payments","$"],["Requests",base+"/requests","＋"],["Feedback",base+"/feedback","★"],["Profile",base+"/profile","⚙"]]
    :[["Today",base,"⌂"],["Checklist",base+"/checklist","✓"],["Route",base+"/route","⌘"],["Photos",base+"/photos","▧"],["Hours",base+"/hours","◷"],["Training",base+"/training","▣"]];
  const initials=type==="Customer"?"CS":"FD";
  const subtitle=type==="Customer"?"Customer Portal":"Field App";
  const[unread,setUnread]=useState(type==="Customer"?1:3);
  const[mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const clearNotifications=()=>setUnread(0);
  return <div className="admin-pro-shell portal-pro-shell">
    <aside className={`pro-sidebar ${mobileMenuOpen?"mobile-menu-open":""}`}>
      <button type="button" className="mobile-menu-close" onClick={()=>setMobileMenuOpen(false)} aria-label="Close menu">×</button>
      <Link href={base} className="season-logo" aria-label="Damasio Seasons portal">
        <div className="season-title"><span>DAMASIO</span><strong>SEASONS</strong></div>
        <div className="grass-mask" aria-hidden="true"><span></span><span></span><span></span></div>
        <div className="mower-man" aria-hidden="true"><i className="head"></i><i className="body"></i><i className="leg one"></i><i className="leg two"></i><i className="arm"></i><i className="mower"></i></div>
      </Link>
      <Link href={base+"/profile"} className="admin-profile clickable-profile">
        <div className="profile-avatar">{initials}</div>
        <div><strong>{type==="Customer"?"Customer Demo":"Filipe Damasio"}</strong><span>{subtitle}</span></div>
        <b>⌄</b>
      </Link>
      <nav className="pro-nav">
        {links.map(([label,href,icon])=><Link key={href} href={href} onClick={()=>setMobileMenuOpen(false)} className={active===label?"active":""}><span>{icon}</span>{label}</Link>)}
        {type==="Customer"&&<Link href="/" onClick={()=>setMobileMenuOpen(false)}><span>⌂</span>Website</Link>}
      </nav>
      <Link href={type==="Customer"?"/customer/requests":"/employee/training"} className="help-card"><span>☏</span><div><strong>Need Help?</strong><small>Contact Support</small></div></Link>
      <button type="button" className="mobile-menu-signout" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
    </aside>
    <main className="pro-main">
      <header className="pro-topbar">
        <button type="button" className="hamburger mobile-menu-toggle" onClick={()=>setMobileMenuOpen(true)} aria-label="Open menu">☰</button>
        <Link href={type==="Customer"?"/customer/services":"/employee/route"} className="topbar-pill">🌿 {type==="Customer"?"Service Portal":"Today’s Route"}</Link>
        <div className="topbar-spacer"></div>
        <Link href={type==="Customer"?"/customer/services":"/employee/route"} className="top-icon">⌕</Link>
        <Link href={type==="Customer"?"/customer/tasks":"/employee/route"} onClick={clearNotifications} className="top-icon notify">♢{unread>0&&<b>{unread}</b>}</Link>
        <Link href={base+"/profile"} className="top-icon">☾</Link>
        <Link href={base+"/profile"} className="mini-user"><span>{initials}</span><i></i></Link>
        <button type="button" className="top-signout" onClick={()=>void signOutAccount()} aria-label="Sign out">Sign out</button>
      </header>
      <div className="pro-content">{children}</div>
    </main>
  </div>
}
