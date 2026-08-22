"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type PremiumMobileHeaderProps = {
  role: "MASTER" | "ADMIN" | "EMPLOYEE" | "CUSTOMER";
  name: string;
  subtitle: string;
  menuHref: string;
  notificationHref?: string;
  avatarUrl?: string | null;
  rightLabel?: string;
};

export function PremiumMobileHeader({
  role,
  name,
  subtitle,
  menuHref,
  notificationHref = menuHref,
  avatarUrl,
  rightLabel = "All Locations",
}: PremiumMobileHeaderProps) {
  return (
    <header className="premium-mobile-header">
      <div className="premium-mobile-brand-row">
        <Link href={menuHref} className="premium-mobile-menu" aria-label="Open menu"><span/><span/><span/></Link>
        <div className="premium-mobile-brand" aria-label="4Ever Seasons Damasio OS">
          <i aria-hidden="true">4S</i>
          <div><strong>4EVER SEASONS</strong><small>DAMASIO OS</small></div>
        </div>
        <Link href={notificationHref} className="premium-mobile-bell" aria-label="Open notifications">AL<b/></Link>
      </div>
      <div className="premium-mobile-identity-row">
        <div className="premium-mobile-role-badge">
          {avatarUrl ? <img src={avatarUrl} alt="Profile"/> : <i aria-hidden="true">{role === "MASTER" ? "MT" : role === "ADMIN" ? "AD" : role === "EMPLOYEE" ? "FD" : "CU"}</i>}
          <span>{role}</span>
        </div>
        <div className="premium-mobile-greeting"><span>{role === "EMPLOYEE" ? "Today's route" : "Operations workspace"}</span><strong>{name}</strong><small>{subtitle}</small></div>
        <Link href={menuHref} className="premium-mobile-location">{rightLabel}<i>⌄</i></Link>
      </div>
    </header>
  );
}

type NavItem = {
  id: string;
  href: string;
  icon: ReactNode;
  label: string;
};

export function PremiumMobileNav({items, active}:{items:NavItem[];active:string}) {
  return (
    <nav className="premium-mobile-nav" aria-label="Mobile navigation">
      {items.map(item => <Link key={item.id} href={item.href} className={item.id === active ? "active" : ""}><i>{item.icon}</i><span>{item.label}</span></Link>)}
    </nav>
  );
}

export function PremiumMetricCard({icon,label,value,note,tone="green",href}:{icon:ReactNode;label:string;value:ReactNode;note:string;tone?:"green"|"gold"|"neutral";href:string}) {
  return <Link href={href} className={`premium-metric-card ${tone}`}><i>{icon}</i><span>{label}</span><strong>{value}</strong><small>{note}</small></Link>;
}
