"use client";

import { useState } from "react";
import Link from "next/link";
import { signOutAccount } from "@/lib/auth/signOut";

export function PortalShell({
  children,
  active,
  type,
}: {
  children: React.ReactNode;
  active: string;
  type: "Customer" | "Employee";
}) {
  const base = type === "Customer" ? "/customer" : "/employee";
  const links =
    type === "Customer"
      ? [
          ["Dashboard", base, "H"],
          ["Services", `${base}/services`, "S"],
          ["Service Issues", `${base}/tasks`, "!"],
          ["History", `${base}/history`, "R"],
          ["Estimates", `${base}/estimates`, "E"],
          ["Notifications", `${base}/notifications`, "N"],
          ["Invoices", `${base}/invoices`, "I"],
          ["Payments", `${base}/payments`, "$"],
          ["Requests", `${base}/requests`, "+"],
          ["Feedback", `${base}/feedback`, "*"],
          ["Profile", `${base}/profile`, "P"],
        ]
      : [
          ["Today", base, "T"],
          ["Checklist", `${base}/checklist`, "C"],
          ["Route", `${base}/route`, "R"],
          ["Photos", `${base}/photos`, "P"],
          ["Hours", `${base}/hours`, "H"],
          ["Training", `${base}/training`, "L"],
        ];
  const initials = type === "Customer" ? "CS" : "FD";
  const subtitle = type === "Customer" ? "Customer Portal" : "Field App";
  const [unread, setUnread] = useState(type === "Customer" ? 1 : 3);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const clearNotifications = () => setUnread(0);

  return (
    <div className={`admin-pro-shell portal-pro-shell ${type === "Employee" ? "employee-portal-shell" : "customer-portal-shell"}`}>
      <aside className={`pro-sidebar ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
        <button type="button" className="mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">x</button>
        <Link href={base} className="season-logo" aria-label="4Ever Seasons portal">
          <div className="season-title"><span>4EVER</span><strong>SEASONS</strong></div>
          <div className="grass-mask" aria-hidden="true"><span></span><span></span><span></span></div>
          <div className="mower-man" aria-hidden="true"><i className="head"></i><i className="body"></i><i className="leg one"></i><i className="leg two"></i><i className="arm"></i><i className="mower"></i></div>
        </Link>
        <Link href={`${base}/profile`} className="admin-profile clickable-profile">
          <div className="profile-avatar">{initials}</div>
          <div><strong>{type === "Customer" ? "Customer Demo" : "Filipe Damasio"}</strong><span>{subtitle}</span></div>
          <b>v</b>
        </Link>
        <nav className="pro-nav">
          {links.map(([label, href, icon]) => (
            <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={active === label ? "active" : ""}>
              <span>{icon}</span>{label}
            </Link>
          ))}
          {type === "Customer" && <Link href="/" onClick={() => setMobileMenuOpen(false)}><span>W</span>Website</Link>}
        </nav>
        <Link href={type === "Customer" ? "/customer/requests" : "/employee/training"} className="help-card">
          <span>?</span><div><strong>Need Help?</strong><small>Contact Support</small></div>
        </Link>
        <button type="button" className="mobile-menu-signout" onClick={() => void signOutAccount("/mobile/login")}>Sign out</button>
      </aside>
      <main className="pro-main">
        <header className="pro-topbar">
          {type === "Customer" && <Link href="/mobile/customer" className="mobile-subpage-back" aria-label="Back to customer home">Back</Link>}
          <button type="button" className="hamburger mobile-menu-toggle" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">Menu</button>
          {type === "Customer" && <span className="mobile-subpage-title"><strong>{active}</strong><small>Customer portal</small></span>}
          <Link href={type === "Customer" ? "/customer/services" : "/employee/route"} className="topbar-pill">{type === "Customer" ? "Service Portal" : "Today's Route"}</Link>
          <div className="topbar-spacer"></div>
          <Link href={type === "Customer" ? "/customer/services" : "/employee/route"} className="top-icon">S</Link>
          <Link href={type === "Customer" ? "/customer/notifications" : "/employee/route"} onClick={clearNotifications} className="top-icon notify">N{unread > 0 && <b>{unread}</b>}</Link>
          <Link href={`${base}/profile`} className="top-icon">P</Link>
          <Link href={`${base}/profile`} className="mini-user"><span>{initials}</span><i></i></Link>
          <button type="button" className="top-signout" onClick={() => void signOutAccount()} aria-label="Sign out">Sign out</button>
        </header>
        <div className="pro-content">{children}</div>
        {type === "Customer" && (
          <nav className="mobile-shell-bottom" aria-label="Customer subpage navigation">
            <Link href="/mobile/customer"><i>H</i><span>Home</span></Link>
            <Link className={active === "Services" ? "active" : ""} href="/customer/services"><i>S</i><span>Services</span></Link>
            <Link className={active === "Requests" ? "active" : ""} href="/customer/requests"><i>+</i><span>Request</span></Link>
            <Link className={active === "Payments" || active === "Invoices" || active === "Estimates" ? "active" : ""} href="/customer/payments"><i>$</i><span>Billing</span></Link>
            <button type="button" onClick={() => setMobileMenuOpen(true)}><i>...</i><span>More</span></button>
          </nav>
        )}
      </main>
    </div>
  );
}
