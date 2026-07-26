"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { PremiumMobileHeader, PremiumMobileNav } from "@/components/mobile/PremiumMobileChrome";
import { loadCustomerPortal } from "@/lib/services/customerPortalService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CustomerPortalBoard } from "@/lib/repositories/customerPortalRepository";

const empty: CustomerPortalBoard = { property: null, visits: [], tasks: [], requests: [], quotes: [], feedback: [] };

function formatDate(value?: string | null) {
  if (!value) return "To be confirmed";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0);
}

export default function MobileCustomerApp() {
  const [board, setBoard] = useState<CustomerPortalBoard>(empty);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const nextBoard = await loadCustomerPortal({ force: true });
        setBoard(nextBoard);
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const response = await fetch("/api/customer/profile", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
          const result = await response.json();
          if (response.ok) setAvatarUrl(result.profile?.avatarUrl || null);
        }
      } catch {
        setError("Your connected customer information is temporarily unavailable.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nextVisit = useMemo(() => board.visits.filter((item) => !["completed", "cancelled", "missed"].includes(item.status)).sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0] || null, [board.visits]);
  const completedVisits = useMemo(() => board.visits.filter((item) => item.status === "completed").sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate))).slice(0, 3), [board.visits]);
  const openTasks = board.tasks.filter((item) => !["completed", "resolved"].includes(item.status));
  const openRequests = board.requests.filter((item) => !["completed", "resolved", "cancelled"].includes(item.status));
  const latestQuote = [...board.quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  const customerName = board.property?.customerName || "Customer";
  const propertyAddress = board.property ? `${board.property.address}, ${board.property.city}, ${board.property.province}` : "Property not connected";

  const nav = [
    { id: "home", href: "/mobile/customer", icon: "⌂", label: "Home" },
    { id: "services", href: "/mobile/customer/services", icon: "♧", label: "Services" },
    { id: "requests", href: "/mobile/customer/requests", icon: "☑", label: "Requests" },
    { id: "billing", href: "/mobile/customer/payments", icon: "$", label: "Billing" },
    { id: "more", href: "/mobile/customer/more", icon: "⋮", label: "More" },
  ];

  return (
    <MobileRoleGuard allowed={["customer"]}>
      <main className="premium-mobile-page">
        <PremiumMobileHeader role="CUSTOMER" name={customerName} subtitle="4Ever Seasons" menuHref="/mobile/customer/more" notificationHref="/mobile/customer/requests" avatarUrl={avatarUrl} rightLabel="My Property" />
        <section className="premium-mobile-content">
          {error && <p className="mobile-message mobile-error" role="alert">{error}</p>}

          <section className="premium-panel premium-customer-next">
            <div>
              <span>NEXT SERVICE</span>
              <h1>{board.property?.address || (loading ? "Loading your property…" : "Property not connected")}</h1>
              <p>{board.property ? `${board.property.city}, ${board.property.province}${board.property.postalCode ? `, ${board.property.postalCode}` : ""}` : "Connect the customer login to the approved quote and property."}</p>
              <div className="premium-customer-detail-grid">
                <div><i>▣</i><div><span>Next visit</span><strong>{formatDate(nextVisit?.scheduledDate)}</strong><small>{nextVisit?.status || "No visit scheduled"}</small></div></div>
                <div><i>♧</i><div><span>Service type</span><strong>{nextVisit?.serviceName || "Property care"}</strong><small>{nextVisit?.crewName || "Crew to be assigned"}</small></div></div>
              </div>
            </div>
            <div className="premium-property-art"><Link className="premium-gold-button" href="/mobile/customer/property">View Details <b>›</b></Link></div>
          </section>

          <div className="premium-account-grid">
            <section className="premium-panel premium-account-card"><div><i>▤</i><div><span>Latest Estimate</span><strong>{latestQuote ? money(latestQuote.total) : "No quote"}</strong><small>{latestQuote?.status || "Nothing awaiting approval"}</small></div></div><Link className="premium-gold-button" href="/mobile/customer/estimates">View Estimates <b>›</b></Link></section>
            <section className="premium-panel premium-account-card"><div><i>$</i><div><span>Payments & Visits</span><strong>{board.visits.length}</strong><small>Connected service records</small></div></div><Link className="premium-gold-button" href="/mobile/customer/payments">Open Billing <b>›</b></Link></section>
          </div>

          <section className="premium-panel">
            <div className="premium-panel-head"><div><small>SERVICES</small><h2>Recent visits</h2></div><Link href="/mobile/customer/services">View all</Link></div>
            <div className="premium-list">
              {completedVisits.length ? completedVisits.map((visit) => <Link href="/mobile/customer/history" className="premium-list-row" key={visit.id}><i>♧</i><div><strong>{visit.serviceName}</strong><span>{formatDate(visit.scheduledDate)} · {visit.address || propertyAddress}</span></div><b>Completed</b></Link>) : <div className="premium-list-row"><i>♧</i><div><strong>No completed service yet</strong><span>Your visit history will appear here.</span></div><b>Waiting</b></div>}
            </div>
          </section>

          <div className="premium-two-column">
            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>REQUESTS</small><h2>Service support</h2></div><Link href="/mobile/customer/requests">View all</Link></div>
              <div className="premium-list">
                {openTasks.slice(0, 2).map((task) => <Link className="premium-list-row" href="/mobile/customer/issues" key={task.id}><i>!</i><div><strong>{task.title}</strong><span>{task.customerIssue || task.address || propertyAddress}</span></div><b className="gold">{task.status}</b></Link>)}
                {openTasks.length === 0 && openRequests.slice(0, 2).map((request) => <Link className="premium-list-row" href="/mobile/customer/requests" key={request.id}><i>＋</i><div><strong>{request.serviceName}</strong><span>{request.message || request.address || propertyAddress}</span></div><b>{request.status}</b></Link>)}
                {openTasks.length === 0 && openRequests.length === 0 && <div className="premium-list-row"><i>✓</i><div><strong>No open request</strong><span>Your account has no unresolved issue.</span></div><b>Clear</b></div>}
              </div>
            </section>

            <section className="premium-panel">
              <div className="premium-panel-head"><div><small>PAYMENTS & TIPS</small><h2>Account activity</h2></div><Link href="/mobile/customer/payments">View</Link></div>
              <div className="premium-summary-list">
                <div className="premium-summary-item"><i>$</i><div><span>Quotes</span><strong>{board.quotes.length}</strong><small>Connected estimates</small></div></div>
                <div className="premium-summary-item"><i>★</i><div><span>Feedback</span><strong>{board.feedback.length}</strong><small>Submitted reviews</small></div></div>
                <div className="premium-summary-item"><i>!</i><div><span>Open issues</span><strong>{openTasks.length}</strong><small>Service follow-up</small></div></div>
              </div>
            </section>
          </div>

          <section className="premium-promo"><div><strong>Refer a neighbour, earn rewards.</strong><span>Share 4Ever Seasons from your customer account.</span></div><Link href="/mobile/customer/more">Refer Now</Link></section>
        </section>
        <PremiumMobileNav items={nav} active="home" />
      </main>
    </MobileRoleGuard>
  );
}
