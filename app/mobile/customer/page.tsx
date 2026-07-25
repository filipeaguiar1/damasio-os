"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileCustomerNav } from "@/components/mobile/MobileCustomerNav";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const empty: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

function initials(name?: string | null) {
  const parts = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "CU").toUpperCase();
}

export default function MobileCustomerApp() {
  const [board, setBoard] = useState<CustomerPortalBoard>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadCustomerPortal({ force: true })
      .then(setBoard)
      .catch(() => setError("Your connected customer information is temporarily unavailable."))
      .finally(() => setLoading(false));
  }, []);

  const nextVisit = useMemo(() => board.visits.filter((item) => !["completed", "cancelled"].includes(item.status)).sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0] || null, [board.visits]);
  const openTasks = board.tasks.filter((item) => !["completed", "resolved"].includes(item.status)).length;
  const customerInitials = initials(board.property?.customerName);
  const modules = [
    { href: "/mobile/customer/services", icon: "✦", label: "Services" },
    { href: "/mobile/customer/history", icon: "↶", label: "History" },
    { href: "/mobile/customer/requests", icon: "+", label: "Request" },
    { href: "/mobile/customer/estimates", icon: "▤", label: "Estimates" },
    { href: "/mobile/customer/invoices", icon: "≡", label: "Invoices" },
    { href: "/mobile/customer/payments", icon: "$", label: "Payments" },
    { href: "/mobile/customer/feedback", icon: "★", label: "Feedback" },
    { href: "/mobile/customer/profile", icon: "⌂", label: "My Property" },
  ];

  return (
    <MobileRoleGuard allowed={["customer"]}>
      <main className="mobile-app-shell role-mobile-shell role-customer-mobile">
        <header className="role-mobile-topbar">
          <MobileBackButton />
          <div><strong>My home</strong><span>{board.property?.customerName || "Customer portal"}</span></div>
          <Link href="/mobile/customer/account" className="role-mobile-avatar role-mobile-profile-avatar" aria-label="Open customer profile">{customerInitials}</Link>
        </header>

        {error && <p className="mobile-message mobile-error" role="alert">{error}</p>}

        <section className="mobile-hero-card compact role-customer-hero">
          <span className="role-mobile-eyebrow">PRIMARY PROPERTY</span>
          {loading ? <><h1>Loading your account...</h1><p>Connecting your customer and property records.</p></> : board.property ? <>
            <div className="role-customer-status"><i>✓</i><span><strong>{nextVisit ? "Service scheduled" : "Property connected"}</strong><small>{nextVisit?.serviceName || "Customer account active"}</small></span></div>
            <p>{board.property.address}, {board.property.city}</p>
            <div className="role-next-visit"><span>Next visit</span><strong>{nextVisit?.scheduledDate || "To be confirmed"}</strong><small>{nextVisit ? `Status · ${nextVisit.status}` : "No visit scheduled"}</small></div>
          </> : <><h1>Property not connected.</h1><p>Your quote information has not been linked to this login yet.</p><Link className="role-mobile-hero-link" href="/mobile/customer/profile">Check property <span>→</span></Link></>}
        </section>

        <section className="mobile-stats-card">
          <Link href="/mobile/customer/services"><span>Services</span><strong>{board.visits.length}</strong><small>connected</small></Link>
          <Link href="/mobile/customer/estimates"><span>Estimates</span><strong>{board.quotes.length}</strong><small>quotes</small></Link>
          <Link href="/mobile/customer/invoices"><span>Invoices</span><strong>→</strong><small>billing</small></Link>
          <Link href="/mobile/customer/issues"><span>Tasks</span><strong>{openTasks}</strong><small>follow-up</small></Link>
        </section>

        <section className="role-mobile-section">
          <div className="role-mobile-section-head"><div><span>MY ACCOUNT</span><h2>What do you need?</h2></div></div>
          <div className="role-customer-modules">{modules.map((module) => <Link href={module.href} key={module.href}><i>{module.icon}</i><span>{module.label}</span></Link>)}</div>
        </section>

        <MobileCustomerNav active="home" />
      </main>
    </MobileRoleGuard>
  );
}
