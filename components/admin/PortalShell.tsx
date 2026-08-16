"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOutAccount } from "@/lib/auth/signOut";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function profileInitials(name: string, fallback: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

export function PortalShell({ children, active, type }: { children: React.ReactNode; active: string; type: "Customer" | "Employee" }) {
  const base = type === "Customer" ? "/customer" : "/employee";
  const links = type === "Customer"
    ? [["Dashboard", base], ["Services", `${base}/services`], ["Service Issues", `${base}/tasks`], ["History", `${base}/history`], ["Estimates", `${base}/estimates`], ["Notifications", `${base}/notifications`], ["Payments", `${base}/payments`], ["Requests", `${base}/requests`], ["Feedback", `${base}/feedback`], ["My Property", `${base}/property`], ["Profile", `${base}/profile`]]
    : [["Today", base], ["Checklist", `${base}/checklist`], ["Route", `${base}/route`], ["Photos", `${base}/photos`], ["Hours", `${base}/hours`], ["Training", `${base}/training`]];
  const [profileName, setProfileName] = useState(type === "Customer" ? "Customer" : "Employee");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const initials = useMemo(() => profileInitials(profileName, type === "Customer" ? "CU" : "EM"), [profileName, type]);
  const subtitle = type === "Customer" ? "Customer Portal" : "Field App";
  const [unread, setUnread] = useState(type === "Customer" ? 1 : 3);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const endpoint = type === "Customer" ? "/api/customer/profile" : "/api/employee/profile";
        const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) return;
        const profile = result.profile || {};
        setProfileName(profile.fullName || profile.full_name || (type === "Customer" ? "Customer" : "Employee"));
        setAvatarUrl(profile.avatarUrl || profile.avatar_url || null);
      } catch {}
    })();
  }, [type]);

  const avatar = avatarUrl ? <img src={avatarUrl} alt={`${profileName} profile`}/> : initials;
  return <div className={`admin-pro-shell portal-pro-shell ${type === "Employee" ? "employee-portal-shell" : "customer-portal-shell"}`}>
    <aside className={`pro-sidebar ${mobileMenuOpen ? "mobile-menu-open" : ""}`}><button type="button" className="mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">x</button><Link href={base} className="season-logo portal-brand-card" aria-label="4Ever Seasons portal"><div className="season-title"><span>4EVER</span><strong>SEASONS</strong></div><div className="grass-mask" aria-hidden="true"><span></span><span></span><span></span></div><div className="mower-man" aria-hidden="true"><i className="head"></i><i className="body"></i><i className="leg one"></i><i className="leg two"></i><i className="arm"></i><i className="mower"></i></div></Link><Link href={`${base}/profile`} className="admin-profile clickable-profile"><div className="profile-avatar">{avatar}</div><div><strong>{profileName}</strong><span>{subtitle}</span></div><b>v</b></Link><nav className="pro-nav portal-word-nav">{links.map(([label, href]) => <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={active === label ? "active" : ""}>{label}</Link>)}</nav><Link href={type === "Customer" ? "/customer/requests" : "/employee/training"} className="help-card"><span>?</span><div><strong>Need Help?</strong><small>Contact Support</small></div></Link><button type="button" className="mobile-menu-signout" onClick={() => void signOutAccount("/mobile/login")}>Sign out</button></aside>
    <main className="pro-main"><header className="pro-topbar">{type === "Customer" && <Link href="/mobile/customer" className="mobile-subpage-back" aria-label="Back to customer home">Back</Link>}<button type="button" className="hamburger mobile-menu-toggle" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">Menu</button>{type === "Customer" && <span className="mobile-subpage-title"><strong>{active}</strong><small>Customer portal</small></span>}<Link href={type === "Customer" ? "/customer/services" : "/employee/route"} className="topbar-pill">{type === "Customer" ? "Service Portal" : "Today's Route"}</Link><div className="topbar-spacer"></div><Link href={type === "Customer" ? "/customer/notifications" : "/employee/route"} onClick={() => setUnread(0)} className="top-icon notify notification-dot-only" aria-label="Notifications"><span className="notification-dot"></span>{unread > 0 && <b>{unread}</b>}</Link><Link href={`${base}/profile`} className="mini-user"><span>{avatar}</span><i></i></Link><button type="button" className="top-signout" onClick={() => void signOutAccount()} aria-label="Sign out">Sign out</button></header><div className="pro-content">{children}</div>{type === "Customer" && <nav className="mobile-shell-bottom" aria-label="Customer subpage navigation"><Link href="/mobile/customer"><i>H</i><span>Home</span></Link><Link className={active === "Services" ? "active" : ""} href="/customer/services"><i>S</i><span>Services</span></Link><Link className={active === "Requests" ? "active" : ""} href="/customer/requests"><i>+</i><span>Request</span></Link><Link className={active === "Payments" || active === "Invoices" || active === "Estimates" ? "active" : ""} href="/customer/payments"><i>$</i><span>Billing</span></Link><button type="button" onClick={() => setMobileMenuOpen(true)}><i>...</i><span>More</span></button></nav>}</main>
  </div>;
}
