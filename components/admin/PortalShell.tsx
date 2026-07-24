"use client";

import { useState } from "react";
import Link from "next/link";
import { signOutAccount } from "@/lib/auth/signOut";

export function PortalShell({ children, active, type }: { children: React.ReactNode; active: string; type: "Customer" | "Employee" }) {
  const base = type === "Customer" ? "/customer" : "/employee";
  const links = type === "Customer"
    ? [["Dashboard",base,"H"],["Services",`${base}/services`,"S"],["Service Issues",`${base}/tasks`,"!"],["History",`${base}/history`,"R"],["Estimates",`${base}/estimates`,"E"],["Notifications",`${base}/notifications`,"N"],["Invoices",`${base}/invoices`,"I"],["Payments",`${base}/payments`,"$"],["Requests",`${base}/requests`,"+"],["Feedback",`${base}/feedback`,"*"],["Profile",`${base}/profile`,"P"]]
    : [["Today",base,"T"],["Checklist",`${base}/checklist`,"C"],["Route",`${base}/route`,"R"],["Photos",`${base}/photos`,"P"],["Hours",`${base}/hours`,"H"],["Training",`${base}/training`,"L"]];
  const initials = type === "Customer" ? "CS" : "FD";
  const subtitle = type === "Customer" ? "Customer Portal" : "Field App";
  const [unread, setUnread] = useState(type === "Customer" ? 1 : 3);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return <div className={`admin-pro-shell portal-pro-shell ${type === "Employee" ? "employee-portal-shell" : "customer-portal-shell"}`}>
    {mobileMenuOpen && <button className="portal-mobile-backdrop" aria-label="Close menu" onClick={()=>setMobileMenuOpen(false)}/>} 
    <aside className={`pro-sidebar ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
      <button type="button" className="mobile-menu-close" onClick={()=>setMobileMenuOpen(false)} aria-label="Close menu">×</button>
      <Link href={base} className="season-logo" aria-label="4Ever Seasons portal"><div className="season-title"><span>4EVER</span><strong>SEASONS</strong></div><div className="grass-mask" aria-hidden="true"><span/><span/><span/></div><div className="mower-man" aria-hidden="true"><i className="head"/><i className="body"/><i className="leg one"/><i className="leg two"/><i className="arm"/><i className="mower"/></div></Link>
      <Link href={`${base}/profile`} className="admin-profile clickable-profile"><div className="profile-avatar">{initials}</div><div><strong>{type === "Customer" ? "Customer Demo" : "Filipe Damasio"}</strong><span>{subtitle}</span></div><b>›</b></Link>
      <nav className="pro-nav">{links.map(([label,href,icon])=><Link key={href} href={href} onClick={()=>setMobileMenuOpen(false)} className={active===label?"active":""}><span>{icon}</span>{label}</Link>)}{type === "Customer" && <Link href="/" onClick={()=>setMobileMenuOpen(false)}><span>W</span>Website</Link>}</nav>
      <Link href={type === "Customer" ? "/customer/requests" : "/employee/training"} className="help-card"><span>?</span><div><strong>Need Help?</strong><small>Contact Support</small></div></Link>
      <button type="button" className="mobile-menu-signout" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
    </aside>
    <main className="pro-main">
      <header className="pro-topbar">
        <button type="button" className="hamburger mobile-menu-toggle" onClick={()=>setMobileMenuOpen(true)} aria-label="Open menu">☰</button>
        <Link href={base} className="portal-mobile-title"><strong>{active}</strong><small>{subtitle}</small></Link>
        <Link href={type === "Customer" ? "/customer/services" : "/employee/route"} className="topbar-pill">{type === "Customer" ? "Service Portal" : "Today's Route"}</Link>
        <div className="topbar-spacer"/>
        <Link href={type === "Customer" ? "/customer/services" : "/employee/route"} className="top-icon">S</Link>
        <Link href={type === "Customer" ? "/customer/notifications" : "/employee/route"} onClick={()=>setUnread(0)} className="top-icon notify">N{unread>0&&<b>{unread}</b>}</Link>
        <Link href={`${base}/profile`} className="mini-user"><span>{initials}</span><i/></Link>
        <button type="button" className="top-signout" onClick={()=>void signOutAccount()} aria-label="Sign out">Sign out</button>
      </header>
      <div className="pro-content">{children}</div>
      <nav className="portal-browser-bottom" aria-label={`${type} navigation`}>
        <Link className={active===(type==="Customer"?"Dashboard":"Today")?"active":""} href={base}><i>H</i><span>Home</span></Link>
        <Link className={active===(type==="Customer"?"Services":"Route")?"active":""} href={type==="Customer"?"/customer/services":"/employee/route"}><i>{type==="Customer"?"S":"R"}</i><span>{type==="Customer"?"Services":"Route"}</span></Link>
        <Link className={active===(type==="Customer"?"Requests":"Checklist")?"active":""} href={type==="Customer"?"/customer/requests":"/employee/checklist"}><i>{type==="Customer"?"+":"C"}</i><span>{type==="Customer"?"Request":"Checklist"}</span></Link>
        <Link className={type==="Customer"&&["Payments","Invoices","Estimates"].includes(active)?"active":""} href={type==="Customer"?"/customer/payments":"/employee/photos"}><i>{type==="Customer"?"$":"P"}</i><span>{type==="Customer"?"Billing":"Photos"}</span></Link>
        <button type="button" onClick={()=>setMobileMenuOpen(true)}><i>•••</i><span>More</span></button>
      </nav>
    </main>
  </div>;
}
